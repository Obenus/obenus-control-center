import { prisma } from "./auth";

export async function logAudit(userId: string | null, action: string, entity: string, entityId?: string, details?: string, ipAddress?: string) {
    try {
        await prisma.auditLog.create({
            data: {
                userId,
                action,
                entity,
                entityId,
                details,
                ipAddress: ipAddress || "0.0.0.0"
            }
        });
    } catch (error) {
        console.error("🔴 Failed to write audit log:", error);
    }
}
