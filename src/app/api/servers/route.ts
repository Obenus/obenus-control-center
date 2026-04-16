import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, prisma } from "@/lib/auth";
import { encrypt } from "@/lib/encryption";
import { logAudit } from "@/lib/audit";

export async function GET() {
    const session = await getServerSession(authOptions);
    if (!session) return new NextResponse("Unauthorized", { status: 401 });

    try {
        const servers = await prisma.server.findMany({
            where: (session.user as any).role === "ADMIN" ? {} : { userId: (session.user as any).id },
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
            }
        });
        return NextResponse.json(servers);
    } catch (error) {
        return new NextResponse("Internal Error", { status: 500 });
    }
}

export async function POST(req: Request) {
    const session = await getServerSession(authOptions);
    if (!session) return new NextResponse("Unauthorized", { status: 401 });

    try {
        const body = await req.json();
        const { name, hostname, ip, os, connectionType, sshPort, sshUser, authMethod, credential, notes, tags } = body;

        const encryptedCredential = encrypt(credential);

        const server = await prisma.server.create({
            data: {
                userId: (session.user as any).id,
                name,
                hostname,
                ip,
                os,
                connectionType: connectionType || "ssh",
                sshPort: parseInt(sshPort, 10) || 22,
                sshUser: sshUser || "root",
                authMethod: authMethod || "KEY",
                credential: encryptedCredential,
                notes,
                tags: tags ? JSON.stringify(tags) : null,
            }
        });

        await logAudit((session.user as any).id, "CREATE_SERVER", "Server", server.id, `Añadido nodo ${name} al sistema`, req.headers.get("x-forwarded-for") || undefined);

        // Don't return credentials
        const { credential: _, ...safeServer } = server;
        return NextResponse.json(safeServer);
    } catch (error) {
        console.error(error);
        return new NextResponse("Internal Error", { status: 500 });
    }
}
