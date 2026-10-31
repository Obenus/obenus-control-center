import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { requireAdmin } from "@/lib/access";
import { getNotificationConfig } from "@/lib/notifications";

export async function POST(req: Request) {
    const admin = await requireAdmin();
    if (admin.error) return admin.error;

    try {
        const body = await req.json().catch(() => ({}));
        const cfg = await getNotificationConfig();
        const host = body.host || cfg.smtp.host;
        const port = String(body.port || cfg.smtp.port || "587");
        const user = body.user || cfg.smtp.user;
        const pass =
            typeof body.pass === "string" && body.pass.trim() ? body.pass.trim() : cfg.smtp.pass;
        const recipients = body.recipients || cfg.smtp.recipients;

        if (!host || !user || !pass) {
            return NextResponse.json(
                { success: false, log: "Falta host, usuario o contraseña SMTP" },
                { status: 400 }
            );
        }

        const transporter = nodemailer.createTransport({
            host,
            port: parseInt(port, 10),
            secure: port === "465",
            auth: { user, pass },
            debug: false,
            logger: false,
        });

        const targetEmail = recipients ? String(recipients).split(",")[0].trim() : user;

        const info = await transporter.sendMail({
            from: `"Obenus Hub Test" <${user}>`,
            to: targetEmail,
            subject: "[Obenus Hub] Prueba de Configuración SMTP",
            text: "Si lees esto, SMTP en Obenus Control Center funciona.",
        });

        return NextResponse.json({
            success: true,
            log: `Message sent: ${info.messageId}`,
        });
    } catch (e: any) {
        return NextResponse.json(
            { success: false, log: e.message || String(e) },
            { status: 400 }
        );
    }
}
