import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, prisma } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

export async function POST(req: Request) {
    const session = await getServerSession(authOptions);
    if ((session?.user as any)?.role !== "ADMIN") {
        return new NextResponse("Unauthorized", { status: 401 });
    }

    try {
        const body = await req.json();
        const { smtpHost, smtpUser, smtpPass, smtpPort, smtpRecipients, smtpFilters, telegramToken, telegramChatId } = body;

        if (smtpHost !== undefined) {
            const smtpValue = JSON.stringify({ host: smtpHost, user: smtpUser, pass: smtpPass, port: smtpPort || "587", recipients: smtpRecipients, filters: smtpFilters || ["ERROR", "CRITICAL"] });
            await prisma.appConfig.upsert({
                where: { key: "SMTP_CONFIG" },
                update: { value: smtpValue },
                create: { key: "SMTP_CONFIG", value: smtpValue }
            });
            await logAudit((session?.user as any)?.id || "system", "UPDATE_SETTINGS", "AppConfig", "SMTP_CONFIG", "Actualizada la configuración de SMTP", req.headers.get("x-forwarded-for") || undefined);
        }

        if (telegramToken !== undefined) {
            const telValue = JSON.stringify({ token: telegramToken, chatId: telegramChatId });
            await prisma.appConfig.upsert({
                where: { key: "TELEGRAM_CONFIG" },
                update: { value: telValue },
                create: { key: "TELEGRAM_CONFIG", value: telValue }
            });
            await logAudit((session?.user as any)?.id || "system", "UPDATE_SETTINGS", "AppConfig", "TELEGRAM_CONFIG", "Actualizada la configuración del Bot de Telegram", req.headers.get("x-forwarded-for") || undefined);
        }

        return NextResponse.json({ success: true });
    } catch (e) {
        console.error(e);
        return new NextResponse("Internal Error", { status: 500 });
    }
}
