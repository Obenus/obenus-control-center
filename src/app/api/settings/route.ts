import { NextResponse } from "next/server";
import { prisma } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { requireAdmin } from "@/lib/access";
import { encryptSmtpPass, getNotificationConfig } from "@/lib/notifications";
import { getAlertMuteConfig, setAlertMuteConfig } from "@/lib/alertMute";

export async function GET() {
    const admin = await requireAdmin();
    if (admin.error) return admin.error;
    const cfg = await getNotificationConfig();
    const mutes = await getAlertMuteConfig();
    return NextResponse.json({
        smtp: {
            host: cfg.smtp.host,
            port: cfg.smtp.port,
            user: cfg.smtp.user,
            from: cfg.smtp.from,
            recipients: cfg.smtp.recipients,
            filters: cfg.smtp.filters,
            hasPass: Boolean(cfg.smtp.pass),
        },
        alertMutes: mutes,
    });
}

export async function POST(req: Request) {
    const admin = await requireAdmin();
    if (admin.error) return admin.error;

    try {
        const body = await req.json();
        const { smtpHost, smtpUser, smtpPass, smtpPort, smtpRecipients, smtpFilters, muteGlobalHours } =
            body;

        const current = await getNotificationConfig();

        if (smtpHost !== undefined) {
            const passPlain =
                typeof smtpPass === "string" && smtpPass.trim()
                    ? smtpPass.trim()
                    : current.smtp.pass;
            const smtpValue = JSON.stringify({
                host: String(smtpHost || "").slice(0, 253),
                user: String(smtpUser || "").slice(0, 253),
                pass: passPlain ? encryptSmtpPass(passPlain) : "",
                port: String(smtpPort || "587").slice(0, 6),
                recipients: String(smtpRecipients || "").slice(0, 2000),
                filters: Array.isArray(smtpFilters)
                    ? smtpFilters.filter((f: string) =>
                          ["ERROR", "CRITICAL", "SUCCESS", "AUDIT"].includes(f)
                      )
                    : ["ERROR", "CRITICAL"],
            });
            await prisma.appConfig.upsert({
                where: { key: "SMTP_CONFIG" },
                update: { value: smtpValue },
                create: { key: "SMTP_CONFIG", value: smtpValue },
            });
            await logAudit(
                admin.user.id,
                "UPDATE_SETTINGS",
                "AppConfig",
                "SMTP_CONFIG",
                "Actualizada la configuración de SMTP (secretos no registrados)",
                req.headers.get("x-forwarded-for") || undefined
            );
        }

        if (muteGlobalHours !== undefined) {
            const hours = Number(muteGlobalHours);
            if (Number.isFinite(hours) && hours > 0 && hours <= 168) {
                const until = new Date(Date.now() + hours * 3600_000).toISOString();
                await setAlertMuteConfig({ globalUntil: until });
                await logAudit(
                    admin.user.id,
                    "MUTE_ALERTS",
                    "AppConfig",
                    "ALERT_MUTES",
                    `Silencio global ${hours}h hasta ${until}`,
                    req.headers.get("x-forwarded-for") || undefined
                );
            } else if (hours === 0) {
                await setAlertMuteConfig({ globalUntil: null });
            }
        }

        return NextResponse.json({ success: true });
    } catch {
        return new NextResponse("Internal Error", { status: 500 });
    }
}
