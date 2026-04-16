import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function POST(req: Request) {
    const session = await getServerSession(authOptions);
    if ((session?.user as any)?.role !== "ADMIN") return new NextResponse("Unauthorized", { status: 401 });

    try {
        const { token, chatId } = await req.json();

        const url = `https://api.telegram.org/bot${token}/sendMessage`;
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id: chatId,
                text: "✅ <b>[Obenus Hub Test]</b>\n¡Tu configuración de Telegram Bot API es correcta y la conexión está activa!",
                parse_mode: "HTML"
            })
        });

        const data = await res.json();

        if (!res.ok) {
            return NextResponse.json({ success: false, log: `Telegram Error: ${JSON.stringify(data)}` }, { status: 400 });
        }

        return NextResponse.json({ success: true, log: `Message sent to ${data.result.chat.id} successfully.` });
    } catch (e: any) {
        return NextResponse.json({ success: false, log: e.message || String(e) }, { status: 400 });
    }
}
