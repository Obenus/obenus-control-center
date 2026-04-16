import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, prisma } from "@/lib/auth";

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

        // Get last 24 hours of metrics
        const history = await prisma.metricHistory.findMany({
            where: {
                serverId,
                createdAt: {
                    gte: new Date(Date.now() - 24 * 60 * 60 * 1000)
                }
            },
            orderBy: { createdAt: "asc" },
            select: {
                cpu: true,
                ram: true,
                disk: true,
                createdAt: true
            }
        });

        // Format for Recharts
        const formatted = history.map(h => ({
            time: new Date(h.createdAt).toLocaleTimeString("es-ES", { hour: '2-digit', minute: '2-digit' }),
            cpu: h.cpu,
            ram: h.ram,
            disk: h.disk
        }));

        return NextResponse.json(formatted);
    } catch (error) {
        console.error(error);
        return new NextResponse("History Fetch Error", { status: 500 });
    }
}
