import { NextResponse } from "next/server";
import { executeSSHCommand } from "@/core/ssh/sshService";
import { isSafeDockerId, requireServerAccess } from "@/lib/access";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id: serverId } = await params;
        const access = await requireServerAccess(serverId);
        if (access.error) return access.error;

        const command = `docker ps -a --format '{"id":"{{.ID}}", "name":"{{.Names}}", "image":"{{.Image}}", "state":"{{.State}}", "status":"{{.Status}}"}'`;
        const { stdout, stderr, code } = await executeSSHCommand(access.server, command);

        if (code !== 0 && !stdout.includes("id")) {
            return NextResponse.json({ error: "Docker no está listado o no hay permisos. " + stderr }, { status: 400 });
        }

        const lines = stdout.split("\n").filter((l) => l.trim().length > 0);
        const containers = [];
        for (const line of lines) {
            try {
                containers.push(JSON.parse(line));
            } catch {
                /* skip malformed */
            }
        }

        return NextResponse.json(containers);
    } catch (error) {
        console.error("Docker fetch error");
        return new NextResponse("Internal", { status: 500 });
    }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id: serverId } = await params;
        const access = await requireServerAccess(serverId);
        if (access.error) return access.error;

        const body = await req.json();
        const { action, containerId } = body;

        if (!["start", "stop", "restart", "rm"].includes(action)) {
            return new NextResponse("Invalid action", { status: 400 });
        }
        if (!isSafeDockerId(containerId)) {
            return NextResponse.json({ error: "ID de contenedor inválido" }, { status: 400 });
        }

        // ID validado como hex: sin inyección de shell
        const command = action === "rm"
            ? `docker rm -f ${containerId}`
            : `docker ${action} ${containerId}`;
        const { stdout, code } = await executeSSHCommand(access.server, command);

        return NextResponse.json({ success: code === 0, output: stdout });
    } catch {
        return new NextResponse("Internal", { status: 500 });
    }
}
