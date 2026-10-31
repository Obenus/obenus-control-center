import crypto from "crypto";
import { PrismaClient } from "@prisma/client";

export const TRUST_COOKIE = "obenus_2fa_trust";
export const TRUST_DAYS = 30;
export const TRUST_MAX_AGE_SEC = TRUST_DAYS * 24 * 60 * 60;

const prisma = (global as any).prisma || new PrismaClient();

function hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
}

export function parseCookieHeader(cookieHeader: string | undefined, name: string): string | null {
    if (!cookieHeader) return null;
    const parts = cookieHeader.split(";").map((p) => p.trim());
    for (const p of parts) {
        const i = p.indexOf("=");
        if (i === -1) continue;
        if (p.slice(0, i) === name) return decodeURIComponent(p.slice(i + 1));
    }
    return null;
}

/** Comprueba si el token de cookie es válido para este usuario (salta 2FA). */
export async function isTrustedDevice(userId: string, rawToken: string | null): Promise<boolean> {
    if (!rawToken || rawToken.length < 32 || rawToken.length > 200) return false;
    const tokenHash = hashToken(rawToken);
    const row = await prisma.trustedDevice.findUnique({ where: { tokenHash } });
    if (!row || row.userId !== userId) return false;
    if (row.expiresAt.getTime() <= Date.now()) {
        await prisma.trustedDevice.delete({ where: { id: row.id } }).catch(() => undefined);
        return false;
    }
    await prisma.trustedDevice
        .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
        .catch(() => undefined);
    return true;
}

/** Crea dispositivo de confianza y devuelve el token en claro para la cookie. */
export async function createTrustedDevice(
    userId: string,
    label?: string | null
): Promise<{ token: string; expiresAt: Date }> {
    const token = crypto.randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + TRUST_MAX_AGE_SEC * 1000);
    await prisma.trustedDevice.create({
        data: {
            userId,
            tokenHash: hashToken(token),
            label: label ? String(label).slice(0, 180) : null,
            expiresAt,
        },
    });
    // Límite por usuario: máximo 10 dispositivos
    const all = await prisma.trustedDevice.findMany({
        where: { userId },
        orderBy: { lastUsedAt: "desc" },
    });
    if (all.length > 10) {
        const drop = all.slice(10);
        await prisma.trustedDevice.deleteMany({
            where: { id: { in: drop.map((d) => d.id) } },
        });
    }
    return { token, expiresAt };
}

export async function revokeAllTrustedDevices(userId: string): Promise<void> {
    await prisma.trustedDevice.deleteMany({ where: { userId } });
}

export function trustCookieHeader(token: string, secure: boolean): string {
    const parts = [
        `${TRUST_COOKIE}=${encodeURIComponent(token)}`,
        "Path=/",
        `Max-Age=${TRUST_MAX_AGE_SEC}`,
        "HttpOnly",
        "SameSite=Lax",
    ];
    if (secure) parts.push("Secure");
    return parts.join("; ");
}
