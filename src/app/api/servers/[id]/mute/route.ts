import { NextResponse } from "next/server";
import { prisma } from "@/lib/auth";
import { requireServerAccess, requireAdmin } from "@/lib/access";
import { logAudit } from "@/lib/audit";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const admin = await requireAdmin();
    if (admin.error) return admin.error;
    const access = await requireServerAccess(id);
    if (access.error) return access.error;

    const body = await req.json().catch(() => ({}));
    const hours = Number(body.hours);
    if (!Number.isFinite(hours) || hours < 0 || hours > 168) {
        return NextResponse.json({ error: "hours 0–168" }, { status: 400 });
    }

    const until = hours === 0 ? null : new Date(Date.now() + hours * 3600_000);
    await prisma.server.update({
        where: { id },
        data: { alertsMutedUntil: until },
    });
    await logAudit(
        admin.user.id,
        hours === 0 ? "UNMUTE_SERVER" : "MUTE_SERVER",
        "Server",
        id,
        hours === 0 ? "Alertas reactivadas" : `Mute ${hours}h hasta ${until?.toISOString()}`,
        req.headers.get("x-forwarded-for") || undefined
    );
    return NextResponse.json({ success: true, alertsMutedUntil: until });
}
