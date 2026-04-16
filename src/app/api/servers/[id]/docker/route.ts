import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, prisma } from "@/lib/auth";
import { executeSSHCommand } from "@/core/ssh/sshService";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getServerSession(authOptions);
    if (!session) return new NextResponse("Unauthorized", { status: 401 });

    try {
        const { id: serverId } = await params;
        const server = await prisma.server.findUnique({ where: { id: serverId } });
        if (!server) return new NextResponse("Not Found", { status: 404 });

        if ((session.user as any).role !== "ADMIN" && server.userId !== (session.user as any).id) {
            return new NextResponse("Unauthorized", { status: 401 });
        }

        const command = `docker ps -a --format '{"id":"{{.ID}}", "name":"{{.Names}}", "image":"{{.Image}}", "state":"{{.State}}", "status":"{{.Status}}"}'`;
        const { stdout, stderr, code } = await executeSSHCommand(server, command);

        if (code !== 0 && !stdout.includes("id")) {
            return NextResponse.json({ error: "Docker no está listado o no hay permisos. " + stderr }, { status: 400 });
        }

        const lines = stdout.split('\n').filter(l => l.trim().length > 0);
        const containers = lines.map(l => JSON.parse(l));

        return NextResponse.json(containers);
    } catch (error) {
        console.error("Docker fetch error:", error);
        return new NextResponse("Internal", { status: 500 });
    }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getServerSession(authOptions);
    if (!session) return new NextResponse("Unauthorized", { status: 401 });

    try {
        const { id: serverId } = await params;
        const body = await req.json();
        const { action, containerId } = body;

        if (!['start', 'stop', 'restart', 'rm'].includes(action)) return new NextResponse("Invalid action", { status: 400 });

        const server = await prisma.server.findUnique({ where: { id: serverId } });
        if (!server) return new NextResponse("Not Found", { status: 404 });

        if ((session.user as any).role !== "ADMIN" && server.userId !== (session.user as any).id) {
            return new NextResponse("Unauthorized", { status: 401 });
        }

        const command = `docker ${action} ${action === 'rm' ? '-f ' : ''}${containerId}`;
        const { stdout, code } = await executeSSHCommand(server, command);

        return NextResponse.json({ success: code === 0, output: stdout });
    } catch (e) {
        return new NextResponse("Internal", { status: 500 });
    }
}
