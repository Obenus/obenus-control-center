import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, prisma } from "@/lib/auth";
import { loadOfficialAgent } from "@/core/nova/agentPackage";
import { statusLabel } from "@/core/nova/statusLabel";
import { getNovaConfigPublic } from "@/lib/novaConfig";

export async function GET() {
    const session = await getServerSession(authOptions);
    if (!session) return new NextResponse("Unauthorized", { status: 401 });
    if ((session.user as any).role !== "ADMIN") {
        return new NextResponse("Forbidden", { status: 403 });
    }

    try {
        const official = await loadOfficialAgent();
        const servers = await prisma.server.findMany({
            orderBy: { name: "asc" },
            include: { novaAgent: true },
        });

        const rows = servers.map((s) => {
            const a = s.novaAgent;
            const status = a?.installStatus || "UNKNOWN";
            return {
                serverId: s.id,
                name: s.name,
                hostname: s.hostname,
                ip: s.ip,
                os: s.os,
                installStatus: status,
                installStatusLabel: statusLabel(status),
                installedVersion: a?.installedVersion || null,
                installedSha256: a?.installedSha256 || null,
                officialVersion: official.version,
                officialSha256: official.sha256,
                lastCheckedAt: a?.lastCheckedAt || null,
                monitoringStatus: a?.monitoringStatus || "unknown",
                activeAlerts: a?.activeAlerts ?? 0,
                lastError: a?.lastError || null,
                locked: Boolean(a?.operationLockUntil && a.operationLockUntil > new Date()),
                modules: a?.modules ? JSON.parse(a.modules) : null,
                capabilities: a?.capabilities ? JSON.parse(a.capabilities) : null,
            };
        });

        const summary = {
            total: rows.length,
            installed: rows.filter((r) => r.installStatus === "INSTALLED" || r.installStatus === "UPDATE_AVAILABLE").length,
            pendingInstall: rows.filter((r) => r.installStatus === "NOT_INSTALLED" || r.installStatus === "UNKNOWN").length,
            pendingUpdate: rows.filter((r) => r.installStatus === "UPDATE_AVAILABLE").length,
            errors: rows.filter((r) =>
                r.installStatus === "INSTALL_ERROR" || r.installStatus === "CONNECTION_ERROR"
            ).length,
            activeAlerts: rows.reduce((acc, r) => acc + (r.activeAlerts || 0), 0),
            lastGlobalCheck: rows
                .map((r) => r.lastCheckedAt)
                .filter(Boolean)
                .sort((a, b) => new Date(b as Date).getTime() - new Date(a as Date).getTime())[0] || null,
            officialVersion: official.version,
            officialSha256: official.sha256,
            officialSource: official.source,
            officialUpdatedAt: official.updatedAt || null,
        };

        const config = await getNovaConfigPublic();

        return NextResponse.json({ summary, servers: rows, config });
    } catch (e: any) {
        console.error("NOVA list error:", e?.message);
        return new NextResponse("Internal Error", { status: 500 });
    }
}
