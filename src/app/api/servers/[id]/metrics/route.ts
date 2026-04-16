import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, prisma } from "@/lib/auth";
import { fetchServerMetrics } from "@/core/metrics/collector";

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

        const metrics = await fetchServerMetrics(server);

        return NextResponse.json({
            cpu: `${metrics.cpu}%`,
            ram: `${metrics.ram}%`,
            disk: `${metrics.disk}%`,
            raw: ""
        });
    } catch (error) {
        console.error(error);
        return new NextResponse("Fetch Metrics Error", { status: 500 });
    }
}
