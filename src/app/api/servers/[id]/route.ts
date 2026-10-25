import { NextResponse } from "next/server";
import { encrypt } from "@/lib/encryption";
import { logAudit } from "@/lib/audit";
import {
    isSafeIpv4OrHost,
    isSafeSshUser,
    parseSshPort,
    requireServerAccess,
} from "@/lib/access";
import { prisma } from "@/lib/auth";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        const access = await requireServerAccess(id);
        if (access.error) return access.error;

        const { credential: _, ...safeServer } = access.server;
        return NextResponse.json({
            ...safeServer,
            hasCredential: Boolean(access.server.credential),
        });
    } catch {
        return new NextResponse("Internal Error", { status: 500 });
    }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        const access = await requireServerAccess(id);
        if (access.error) return access.error;

        const body = await req.json();
        const data: Record<string, unknown> = {};

        if (body.name !== undefined) {
            const name = String(body.name).trim();
            if (!name || name.length > 120) {
                return NextResponse.json({ error: "Nombre inválido" }, { status: 400 });
            }
            data.name = name;
        }

        if (body.hostname !== undefined) {
            const hostname = String(body.hostname).trim();
            if (hostname && !isSafeIpv4OrHost(hostname)) {
                return NextResponse.json({ error: "Hostname inválido" }, { status: 400 });
            }
            data.hostname = hostname || access.server.ip;
        }

        if (body.ip !== undefined) {
            const ip = String(body.ip).trim();
            if (!isSafeIpv4OrHost(ip)) {
                return NextResponse.json({ error: "IP o host inválido" }, { status: 400 });
            }
            data.ip = ip;
        }

        if (body.os !== undefined) {
            const os = String(body.os).toLowerCase().trim();
            const allowed = ["ubuntu", "debian", "almalinux", "centos", "rocky", "rhel"];
            if (!allowed.includes(os)) {
                return NextResponse.json({ error: "SO no soportado" }, { status: 400 });
            }
            data.os = os;
        }

        if (body.sshPort !== undefined) {
            const port = parseSshPort(body.sshPort);
            if (port === null) {
                return NextResponse.json({ error: "Puerto SSH inválido" }, { status: 400 });
            }
            data.sshPort = port;
        }

        if (body.sshUser !== undefined) {
            const sshUser = String(body.sshUser).trim();
            if (!isSafeSshUser(sshUser)) {
                return NextResponse.json({ error: "Usuario SSH inválido" }, { status: 400 });
            }
            data.sshUser = sshUser;
        }

        if (body.authMethod !== undefined) {
            if (body.authMethod !== "PASSWORD" && body.authMethod !== "KEY") {
                return NextResponse.json({ error: "Método de autenticación inválido" }, { status: 400 });
            }
            data.authMethod = body.authMethod;
        }

        // Credencial solo se actualiza si se envía un valor no vacío (permite rotar password/clave)
        if (typeof body.credential === "string" && body.credential.trim().length > 0) {
            if (body.credential.length > 100_000) {
                return NextResponse.json({ error: "Credencial demasiado grande" }, { status: 400 });
            }
            data.credential = encrypt(body.credential);
        }

        if (body.notes !== undefined) {
            data.notes = body.notes === null ? null : String(body.notes).slice(0, 5000);
        }

        if (body.status !== undefined) {
            if (body.status !== "ACTIVE" && body.status !== "INACTIVE") {
                return NextResponse.json({ error: "Estado inválido" }, { status: 400 });
            }
            data.status = body.status;
        }

        if (Object.keys(data).length === 0) {
            return NextResponse.json({ error: "Sin cambios" }, { status: 400 });
        }

        const updated = await prisma.server.update({
            where: { id },
            data,
        });

        const credentialChanged = Boolean(data.credential);
        await logAudit(
            access.user.id,
            credentialChanged ? "UPDATE_SERVER_CREDENTIALS" : "UPDATE_SERVER",
            "Server",
            id,
            credentialChanged
                ? `Actualizada conexión SSH de ${updated.name} (credencial rotada; valor no registrado)`
                : `Actualizada configuración de ${updated.name}`,
            req.headers.get("x-forwarded-for") || undefined
        );

        const { credential: _, ...safeServer } = updated;
        return NextResponse.json({ ...safeServer, hasCredential: true });
    } catch (e) {
        console.error("Server PATCH error");
        return new NextResponse("Internal Error", { status: 500 });
    }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params;
        const access = await requireServerAccess(id);
        if (access.error) return access.error;

        await prisma.server.delete({ where: { id } });
        await logAudit(
            access.user.id,
            "DELETE_SERVER",
            "Server",
            id,
            `Eliminado nodo ${access.server.name}`,
            req.headers.get("x-forwarded-for") || undefined
        );
        return new NextResponse(null, { status: 204 });
    } catch {
        return new NextResponse("Internal Error", { status: 500 });
    }
}
