import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions, prisma } from "./auth";
import { Server } from "@prisma/client";

export type SessionUser = {
    id: string;
    role: string;
    email?: string | null;
    name?: string | null;
};

export async function requireSession(): Promise<
    { user: SessionUser; error?: never } | { user?: never; error: NextResponse }
> {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
        return { error: new NextResponse("Unauthorized", { status: 401 }) };
    }
    const user = session.user as any;
    if (!user.id) {
        return { error: new NextResponse("Unauthorized", { status: 401 }) };
    }
    return {
        user: {
            id: user.id,
            role: user.role || "USER",
            email: user.email,
            name: user.name,
        },
    };
}

export async function requireAdmin(): Promise<
    { user: SessionUser; error?: never } | { user?: never; error: NextResponse }
> {
    const result = await requireSession();
    if (result.error) return result;
    if (result.user.role !== "ADMIN") {
        return { error: new NextResponse("Forbidden", { status: 403 }) };
    }
    return result;
}

export async function requireServerAccess(
    serverId: string
): Promise<
    { user: SessionUser; server: Server; error?: never } | { user?: never; server?: never; error: NextResponse }
> {
    const auth = await requireSession();
    if (auth.error) return auth;

    if (!serverId || typeof serverId !== "string" || serverId.length > 80) {
        return { error: new NextResponse("Bad Request", { status: 400 }) };
    }

    const server = await prisma.server.findUnique({ where: { id: serverId } });
    if (!server) {
        return { error: new NextResponse("Not Found", { status: 404 }) };
    }

    if (auth.user.role !== "ADMIN" && server.userId !== auth.user.id) {
        return { error: new NextResponse("Forbidden", { status: 403 }) };
    }

    return { user: auth.user, server };
}

/** Docker container IDs: 12–64 hex chars */
export function isSafeDockerId(id: unknown): id is string {
    return typeof id === "string" && /^[a-f0-9]{12,64}$/i.test(id);
}

export function isSafeIpv4OrHost(value: string): boolean {
    if (!value || value.length > 253) return false;
    if (value.includes(" ") || value.includes(";") || value.includes("|") || value.includes("`")) return false;
    // IPv4
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(value)) {
        return value.split(".").every((o) => {
            const n = Number(o);
            return n >= 0 && n <= 255;
        });
    }
    // hostname
    return /^(?=.{1,253}$)(?!-)[a-zA-Z0-9-]{1,63}(?<!-)(\.(?!-)[a-zA-Z0-9-]{1,63}(?<!-))*$/.test(value);
}

export function parseSshPort(value: unknown): number | null {
    const n = typeof value === "number" ? value : parseInt(String(value), 10);
    if (!Number.isInteger(n) || n < 1 || n > 65535) return null;
    return n;
}

export function isSafeSshUser(value: string): boolean {
    return /^[a-zA-Z0-9._-]{1,32}$/.test(value);
}
