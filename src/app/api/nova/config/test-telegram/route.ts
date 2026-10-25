import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getNovaConfig } from "@/lib/novaConfig";
import { logAudit } from "@/lib/audit";

export async function POST(req: Request) {
    const session = await getServerSession(authOptions);
    if (!session || (session.user as any).role !== "ADMIN") {
        return new NextResponse("Unauthorized", { status: 401 });
    }

    try {
        const body = await req.json().catch(() => ({}));
        const cfg = await getNovaConfig();
        const token = (typeof body.botToken === "string" && body.botToken) || cfg.botToken;
        const chatId = (typeof body.chatId === "string" && body.chatId) || cfg.chatId;

        if (!token || !chatId) {
            return NextResponse.json({ success: false, log: "Faltan token o Chat ID" }, { status: 400 });
        }

        const meRes = await fetch(`https://api.telegram.org/bot${token}/getMe`);
        const me = await meRes.json();
        if (!me.ok) {
            return NextResponse.json({ success: false, log: "Telegram rechazó el token del bot" });
        }

        const sendRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id: chatId,
                text: "🟢 NOVA | Obenus Control Center\nPrueba Telegram correcta (configuración central)",
            }),
        });
        const send = await sendRes.json();
        if (!send.ok) {
            return NextResponse.json({ success: false, log: "No se pudo entregar el mensaje al Chat ID" });
        }

        await logAudit(
            (session.user as any).id,
            "TEST_NOVA_TELEGRAM",
            "AppConfig",
            "NOVA_CONFIG",
            "Prueba Telegram NOVA central correcta",
            req.headers.get("x-forwarded-for") || undefined
        );

        return NextResponse.json({ success: true, log: `Bot @${me.result?.username || "ok"} respondió correctamente` });
    } catch {
        return NextResponse.json({ success: false, log: "Error de red al contactar Telegram" });
    }
}
