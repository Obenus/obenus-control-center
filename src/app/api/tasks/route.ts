import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, prisma } from "@/lib/auth";

export async function GET(req: Request) {
    const session = await getServerSession(authOptions);
    if (!session) return new NextResponse("Unauthorized", { status: 401 });

    const { searchParams } = new URL(req.url);
    const os = searchParams.get("os");

    try {
        const tasks = await prisma.remoteTask.findMany({
            where: os ? { osTarget: { in: [os.toLowerCase(), "all"] } } : {},
            orderBy: { name: "asc" }
        });
        return NextResponse.json(tasks);
    } catch (error) {
        return new NextResponse("Internal Error", { status: 500 });
    }
}
