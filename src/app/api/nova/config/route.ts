import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getNovaConfigPublic, saveNovaConfig } from "@/lib/novaConfig";
import { logAudit } from "@/lib/audit";

export async function GET() {
    const session = await getServerSession(authOptions);
    if (!session || (session.user as any).role !== "ADMIN") {
        return new NextResponse("Unauthorized", { status: 401 });
    }
    return NextResponse.json(await getNovaConfigPublic());
}

export async function POST(req: Request) {
    const session = await getServerSession(authOptions);
    if (!session || (session.user as any).role !== "ADMIN") {
        return new NextResponse("Unauthorized", { status: 401 });
    }

    try {
        const body = await req.json();
        const reportHour = body.reportHour !== undefined ? Number(body.reportHour) : undefined;
        if (reportHour !== undefined && (Number.isNaN(reportHour) || reportHour < 0 || reportHour > 23)) {
            return NextResponse.json({ error: "Hora de informe inválida" }, { status: 400 });
        }

        await saveNovaConfig({
            botToken: typeof body.botToken === "string" ? body.botToken : undefined,
            chatId: typeof body.chatId === "string" ? body.chatId : undefined,
            alertsEnabled: typeof body.alertsEnabled === "boolean" ? body.alertsEnabled : undefined,
            dailyReportEnabled: typeof body.dailyReportEnabled === "boolean" ? body.dailyReportEnabled : undefined,
            reportHour,
            thresholds: body.thresholds && typeof body.thresholds === "object" ? body.thresholds : undefined,
        });

        await logAudit(
            (session.user as any).id,
            "UPDATE_NOVA_CONFIG",
            "AppConfig",
            "NOVA_CONFIG",
            "Actualizada configuración centralizada NOVA (secretos no registrados)",
            req.headers.get("x-forwarded-for") || undefined
        );

        return NextResponse.json({ success: true, config: await getNovaConfigPublic() });
    } catch (e) {
        console.error("NOVA config save error");
        return new NextResponse("Internal Error", { status: 500 });
    }
}
