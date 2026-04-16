import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, prisma } from "@/lib/auth";
import { encrypt } from "@/lib/encryption";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getServerSession(authOptions);
    if (!session) return new NextResponse("Unauthorized", { status: 401 });

    try {
        const resolvedParams = await params;
        const { id } = resolvedParams;

        const server = await prisma.server.findUnique({
            where: { id: id },
        });

        if (!server) return new NextResponse("Not Found", { status: 404 });

        // Validate ownership
        if ((session.user as any).role !== "ADMIN" && server.userId !== (session.user as any).id) {
            return new NextResponse("Unauthorized", { status: 401 });
        }

        const { credential, ...safeServer } = server;
        return NextResponse.json(safeServer);
    } catch (error) {
        return new NextResponse("Internal Error", { status: 500 });
    }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getServerSession(authOptions);
    if (!session) return new NextResponse("Unauthorized", { status: 401 });

    try {
        const resolvedParams = await params;
        const { id } = resolvedParams;

        const server = await prisma.server.findUnique({ where: { id } });
        if (!server) return new NextResponse("Not Found", { status: 404 });

        if ((session.user as any).role !== "ADMIN" && server.userId !== (session.user as any).id) {
            return new NextResponse("Unauthorized", { status: 401 });
        }

        await prisma.server.delete({ where: { id } });
        return new NextResponse(null, { status: 204 });
    } catch (error) {
        return new NextResponse("Internal Error", { status: 500 });
    }
}
