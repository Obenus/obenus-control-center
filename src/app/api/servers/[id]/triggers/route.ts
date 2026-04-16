import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, prisma } from "@/lib/auth";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getServerSession(authOptions);
    if (!session) return new NextResponse("Unauthorized", { status: 401 });
    const { id: serverId } = await params;
    
    const triggers = await prisma.serverTrigger.findMany({ where: { serverId } });
    return NextResponse.json(triggers);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getServerSession(authOptions);
    if (!session || (session.user as any).role !== "ADMIN") return new NextResponse("Unauthorized", { status: 401 });
    
    const { id: serverId } = await params;
    const body = await req.json();
    const { metric, condition, threshold, actionTaskName } = body;

    const trigger = await prisma.serverTrigger.create({
        data: {
            serverId,
            metric,
            condition,
            threshold: parseFloat(threshold),
            actionTaskName
        }
    });

    return NextResponse.json(trigger);
}

export async function DELETE(req: Request) {
    const session = await getServerSession(authOptions);
    if (!session || (session.user as any).role !== "ADMIN") return new NextResponse("Unauthorized", { status: 401 });
    
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return new NextResponse("Missing ID", { status: 400 });

    await prisma.serverTrigger.delete({ where: { id } });
    return new NextResponse("Deleted", { status: 200 });
}
