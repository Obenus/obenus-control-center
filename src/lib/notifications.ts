import nodemailer from "nodemailer";
import { prisma } from "./auth";
import { getNovaConfig, redactSecrets } from "./novaConfig";
import { decrypt, encrypt } from "./encryption";
import { isAlertMuted } from "./alertMute";

type SmtpConfig = {
    host: string;
    port: string;
    user: string;
    pass: string;
    from: string;
    recipients: string;
    filters: string[];
};

function maybeDecryptPass(pass: string): string {
    if (!pass) return "";
    // Valores nuevos van cifrados; si falla, asumir legado en claro (migración).
    try {
        return decrypt(pass);
    } catch {
        return pass;
    }
}

export function encryptSmtpPass(pass: string): string {
    if (!pass) return "";
    return encrypt(pass);
}

export async function getNotificationConfig() {
    const configs = await prisma.appConfig.findMany({
        where: { key: { in: ["SMTP_CONFIG"] } },
    });

    let smtp: SmtpConfig = {
        host: process.env.SMTP_HOST || "",
        port: process.env.SMTP_PORT || "587",
        user: process.env.SMTP_USER || "",
        pass: process.env.SMTP_PASS || "",
        from: process.env.SMTP_FROM || "",
        recipients: "",
        filters: ["ERROR", "CRITICAL"],
    };

    for (const c of configs) {
        if (c.key === "SMTP_CONFIG") smtp = { ...smtp, ...JSON.parse(c.value) };
    }

    smtp.pass = maybeDecryptPass(smtp.pass);

    const nova = await getNovaConfig();
    const telegram = {
        token: nova.botToken || process.env.TELEGRAM_BOT_TOKEN || "",
        chatId: nova.chatId || process.env.TELEGRAM_CHAT_ID || "",
        alertsEnabled: nova.alertsEnabled,
    };

    return { smtp, telegram };
}

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

export async function sendEmail(subject: string, text: string) {
    const { smtp } = await getNotificationConfig();
    if (!smtp.host || !smtp.user || !smtp.pass) return false;

    try {
        const transporter = nodemailer.createTransport({
            host: smtp.host,
            port: parseInt(smtp.port, 10),
            secure: smtp.port === "465",
            auth: { user: smtp.user, pass: smtp.pass },
        });

        const safe = escapeHtml(text);
        await transporter.sendMail({
            from: smtp.from || '"Obenus Control Center" <noreply@obenus.local>',
            to: smtp.recipients || process.env.ADMIN_EMAIL || smtp.user,
            subject: `[Obenus Hub] ${subject}`,
            text,
            html: `<div style="font-family: sans-serif; padding: 25px; background: #050508; color: #f1f5f9; border-radius: 12px; border: 1px solid #1e293b;">
               <h2 style="color: #38bdf8; margin-top: 0;">Obenus Infinity Alert</h2>
               <div style="background: #0f172a; padding: 15px; border-radius: 8px; border-left: 4px solid #6366f1;">
                  <div style="font-family: monospace; color: #94a3b8; font-size: 14px; margin: 0; line-height: 1.5;">
                      ${safe.replace(/\n/g, "<br/>")}
                  </div>
               </div>
             </div>`,
        });
        return true;
    } catch (error) {
        console.error("Failed to send SMTP email:", error);
        return false;
    }
}

export async function sendTelegram(message: string) {
    const { telegram } = await getNotificationConfig();
    if (!telegram.token || !telegram.chatId) return false;
    if (telegram.alertsEnabled === false) return false;

    try {
        const url = `https://api.telegram.org/bot${telegram.token}/sendMessage`;
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id: telegram.chatId,
                text: `<b>[Obenus Hub]</b>\n${message}`,
                parse_mode: "HTML",
            }),
        });
        return response.ok;
    } catch {
        console.error("Failed to send Telegram message");
        return false;
    }
}

export async function notifyEvent(
    subject: string,
    message: string,
    type: "SUCCESS" | "ERROR" | "CRITICAL" | "AUDIT" = "SUCCESS",
    opts?: { serverId?: string | null }
) {
    if (await isAlertMuted(opts?.serverId)) {
        return;
    }

    const { smtp } = await getNotificationConfig();
    const safeMessage = redactSecrets(message);

    let shouldSendEmail = true;
    if (smtp.filters) {
        if (type === "SUCCESS" && !smtp.filters.includes("SUCCESS")) shouldSendEmail = false;
        if ((type === "ERROR" || type === "CRITICAL") && !smtp.filters.includes("ERROR")) shouldSendEmail = false;
        if (type === "AUDIT" && !smtp.filters.includes("AUDIT")) shouldSendEmail = false;
    }

    const promises = [];
    if (shouldSendEmail) promises.push(sendEmail(subject, safeMessage));
    promises.push(
        sendTelegram(`<b>${escapeHtml(subject)}</b>\n<pre>${escapeHtml(safeMessage)}</pre>`)
    );

    await Promise.allSettled(promises);
}
