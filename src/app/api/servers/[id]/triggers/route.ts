import { NextResponse } from "next/server";
import { prisma } from "@/lib/auth";
import { requireAdmin, requireServerAccess } from "@/lib/access";

const ALLOWED_METRICS = new Set(["CPU", "RAM", "DISK"]);
const ALLOWED_CONDITIONS = new Set(["GT", "LT"]);

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id: serverId } = await params;
    const access = await requireServerAccess(serverId);
    if (access.error) return access.error;

    const triggers = await prisma.serverTrigger.findMany({ where: { serverId } });
    return NextResponse.json(triggers);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const admin = await requireAdmin();
    if (admin.error) return admin.error;

    const { id: serverId } = await params;
    const access = await requireServerAccess(serverId);
    if (access.error) return access.error;

    const body = await req.json();
    const { metric, condition, threshold, actionTaskName } = body;

    if (!ALLOWED_METRICS.has(metric) || !ALLOWED_CONDITIONS.has(condition)) {
        return NextResponse.json({ error: "Regla inválida" }, { status: 400 });
    }
    const thr = parseFloat(threshold);
    if (Number.isNaN(thr) || thr < 0 || thr > 100) {
        return NextResponse.json({ error: "Umbral inválido" }, { status: 400 });
    }
    if (typeof actionTaskName !== "string" || !actionTaskName.trim() || actionTaskName.length > 120) {
        return NextResponse.json({ error: "Tarea inválida" }, { status: 400 });
    }

    const trigger = await prisma.serverTrigger.create({
        data: {
            serverId,
            metric,
            condition,
            threshold: thr,
            actionTaskName: actionTaskName.trim(),
        },
    });

    return NextResponse.json(trigger);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const admin = await requireAdmin();
    if (admin.error) return admin.error;

    const { id: serverId } = await params;
    const access = await requireServerAccess(serverId);
    if (access.error) return access.error;

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return new NextResponse("Missing ID", { status: 400 });

    const trigger = await prisma.serverTrigger.findUnique({ where: { id } });
    if (!trigger || trigger.serverId !== serverId) {
        return new NextResponse("Not Found", { status: 404 });
    }

    await prisma.serverTrigger.delete({ where: { id } });
    return new NextResponse("Deleted", { status: 200 });
}
