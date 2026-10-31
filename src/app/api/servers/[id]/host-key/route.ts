import { NextResponse } from "next/server";
import { prisma } from "@/lib/auth";
import { requireServerAccess, requireAdmin } from "@/lib/access";
import { logAudit } from "@/lib/audit";
import { probeHostKeyFingerprint } from "@/core/ssh/sshService";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const access = await requireServerAccess(id);
    if (access.error) return access.error;

    try {
        const fp = await probeHostKeyFingerprint(access.server.ip, access.server.sshPort || 22);
        return NextResponse.json({
            fingerprint: fp,
            stored: access.server.sshHostFingerprint || null,
            confirmed: Boolean(access.server.sshHostFingerprint),
        });
    } catch (e: any) {
        return NextResponse.json(
            { error: e?.message || "No se pudo obtener la clave de host" },
            { status: 502 }
        );
    }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const admin = await requireAdmin();
    if (admin.error) return admin.error;
    const access = await requireServerAccess(id);
    if (access.error) return access.error;

    const body = await req.json().catch(() => ({}));
    const fingerprint = String(body.fingerprint || "").trim();
    if (!/^SHA256:[A-Za-z0-9+/=]+$/.test(fingerprint) || fingerprint.length > 120) {
        return NextResponse.json({ error: "Fingerprint inválido" }, { status: 400 });
    }

    // Re-probe para no confiar solo en el cliente
    let live: string;
    try {
        live = await probeHostKeyFingerprint(access.server.ip, access.server.sshPort || 22);
    } catch (e: any) {
        return NextResponse.json(
            { error: e?.message || "No se pudo verificar la clave en vivo" },
            { status: 502 }
        );
    }
    if (live !== fingerprint) {
        return NextResponse.json(
            { error: "El fingerprint no coincide con el host actual", live },
            { status: 409 }
        );
    }

    await prisma.server.update({
        where: { id },
        data: { sshHostFingerprint: fingerprint },
    });
    await logAudit(
        admin.user.id,
        "CONFIRM_SSH_HOST_KEY",
        "Server",
        id,
        fingerprint,
        req.headers.get("x-forwarded-for") || undefined
    );

    return NextResponse.json({ success: true, fingerprint });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const admin = await requireAdmin();
    if (admin.error) return admin.error;
    const access = await requireServerAccess(id);
    if (access.error) return access.error;

    await prisma.server.update({
        where: { id },
        data: { sshHostFingerprint: null },
    });
    await logAudit(
        admin.user.id,
        "CLEAR_SSH_HOST_KEY",
        "Server",
        id,
        "Fingerprint borrado; se pedirá confirmación de nuevo",
        req.headers.get("x-forwarded-for") || undefined
    );
    return NextResponse.json({ success: true });
}
