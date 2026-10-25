import { NextResponse } from "next/server";
import { prisma } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { requireAdmin } from "@/lib/access";
import { getNotificationConfig } from "@/lib/notifications";

export async function POST(req: Request) {
    const admin = await requireAdmin();
    if (admin.error) return admin.error;

    try {
        const body = await req.json();
        const { smtpHost, smtpUser, smtpPass, smtpPort, smtpRecipients, smtpFilters } = body;

        const current = await getNotificationConfig();

        if (smtpHost !== undefined) {
            const smtpValue = JSON.stringify({
                host: String(smtpHost || "").slice(0, 253),
                user: String(smtpUser || "").slice(0, 253),
                pass: typeof smtpPass === "string" && smtpPass.trim()
                    ? smtpPass
                    : current.smtp.pass,
                port: String(smtpPort || "587").slice(0, 6),
                recipients: String(smtpRecipients || "").slice(0, 2000),
                filters: Array.isArray(smtpFilters)
                    ? smtpFilters.filter((f: string) => ["ERROR", "CRITICAL", "SUCCESS", "AUDIT"].includes(f))
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

        return NextResponse.json({ success: true });
    } catch {
        return new NextResponse("Internal Error", { status: 500 });
    }
}
