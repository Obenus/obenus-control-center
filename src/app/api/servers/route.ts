import { NextResponse } from "next/server";
import { prisma } from "@/lib/auth";
import { encrypt } from "@/lib/encryption";
import { logAudit } from "@/lib/audit";
import { enqueueNovaJob } from "@/lib/queue";
import {
    isSafeIpv4OrHost,
    isSafeSshUser,
    parseSshPort,
    requireSession,
} from "@/lib/access";

export async function GET() {
    const auth = await requireSession();
    if (auth.error) return auth.error;

    try {
        const servers = await prisma.server.findMany({
            where: auth.user.role === "ADMIN" ? {} : { userId: auth.user.id },
            orderBy: { createdAt: "desc" },
            select: {
                id: true,
                name: true,
                hostname: true,
                ip: true,
                os: true,
                status: true,
                tags: true,
                createdAt: true,
            },
        });
        return NextResponse.json(servers);
    } catch {
        return new NextResponse("Internal Error", { status: 500 });
    }
}

export async function POST(req: Request) {
    const auth = await requireSession();
    if (auth.error) return auth.error;

    try {
        const body = await req.json();
        const { name, hostname, ip, os, connectionType, sshPort, sshUser, authMethod, credential, notes, tags, installNova } = body;

        if (typeof name !== "string" || !name.trim() || name.length > 120) {
            return NextResponse.json({ error: "Nombre inválido" }, { status: 400 });
        }
        if (typeof ip !== "string" || !isSafeIpv4OrHost(ip.trim())) {
            return NextResponse.json({ error: "IP o host inválido" }, { status: 400 });
        }
        const host = typeof hostname === "string" && hostname.trim() ? hostname.trim() : ip.trim();
        if (!isSafeIpv4OrHost(host)) {
            return NextResponse.json({ error: "Hostname inválido" }, { status: 400 });
        }
        const port = parseSshPort(sshPort ?? 22);
        if (port === null) {
            return NextResponse.json({ error: "Puerto SSH inválido" }, { status: 400 });
        }
        const user = String(sshUser || "root").trim();
        if (!isSafeSshUser(user)) {
            return NextResponse.json({ error: "Usuario SSH inválido" }, { status: 400 });
        }
        if (authMethod && authMethod !== "PASSWORD" && authMethod !== "KEY") {
            return NextResponse.json({ error: "Método de autenticación inválido" }, { status: 400 });
        }
        if (typeof credential !== "string" || !credential.trim() || credential.length > 100_000) {
            return NextResponse.json({ error: "Credencial requerida" }, { status: 400 });
        }
        const allowedOs = ["ubuntu", "debian", "almalinux", "centos", "rocky", "rhel"];
        const osNorm = String(os || "ubuntu").toLowerCase();
        if (!allowedOs.includes(osNorm)) {
            return NextResponse.json({ error: "SO no soportado" }, { status: 400 });
        }

        const encryptedCredential = encrypt(credential);

        const server = await prisma.server.create({
            data: {
                userId: auth.user.id,
                name: name.trim(),
                hostname: host,
                ip: ip.trim(),
                os: osNorm,
                connectionType: connectionType === "ssh" || !connectionType ? "ssh" : "ssh",
                sshPort: port,
                sshUser: user,
                authMethod: authMethod || "KEY",
                credential: encryptedCredential,
                notes: notes ? String(notes).slice(0, 5000) : null,
                tags: tags ? JSON.stringify(tags) : null,
            },
        });

        await prisma.novaAgent.create({
            data: { serverId: server.id, installStatus: "UNKNOWN" },
        });

        await logAudit(auth.user.id, "CREATE_SERVER", "Server", server.id, `Añadido nodo ${name.trim()} al sistema`, req.headers.get("x-forwarded-for") || undefined);

        if (installNova && auth.user.role === "ADMIN") {
            await enqueueNovaJob("nova-install", {
                serverId: server.id,
                userId: auth.user.id,
            });
            await logAudit(auth.user.id, "NOVA_INSTALL", "Server", server.id, "Instalación automática NOVA encolada", req.headers.get("x-forwarded-for") || undefined);
        }

        const { credential: _, ...safeServer } = server;
        return NextResponse.json(safeServer);
    } catch (error) {
        console.error("CREATE_SERVER error");
        return new NextResponse("Internal Error", { status: 500 });
    }
}
