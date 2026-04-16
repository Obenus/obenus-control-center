import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import nodemailer from "nodemailer";

export async function POST(req: Request) {
    const session = await getServerSession(authOptions);
    if ((session?.user as any)?.role !== "ADMIN") return new NextResponse("Unauthorized", { status: 401 });

    try {
        const { host, port, user, pass, recipients } = await req.json();

        const transporter = nodemailer.createTransport({
            host,
            port: parseInt(port || "587", 10),
            secure: port === "465",
            auth: { user, pass },
            debug: true,
            logger: true
        });

        const targetEmail = recipients ? recipients.split(",")[0].trim() : user;

        const info = await transporter.sendMail({
            from: '"Obenus Hub Test" <' + user + '>',
            to: targetEmail,
            subject: "[Obenus Hub] Prueba de Configuración SMTP",
            text: "¡Si estás leyendo esto, tu configuración SMTP en Obenus Control Center está funcionando perfectamente!",
        });

        return NextResponse.json({ success: true, log: `Message sent: ${info.messageId}\nResponse: ${info.response}` });
    } catch (e: any) {
        return NextResponse.json({ success: false, log: e.message || String(e) }, { status: 400 });
    }
}
