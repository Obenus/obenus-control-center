import { prisma } from "./auth";

export type AlertMuteConfig = {
    /** Silencio global hasta ISO date */
    globalUntil?: string | null;
};

const KEY = "ALERT_MUTES";

export async function getAlertMuteConfig(): Promise<AlertMuteConfig> {
    const row = await prisma.appConfig.findUnique({ where: { key: KEY } });
    if (!row) return {};
    try {
        return JSON.parse(row.value) as AlertMuteConfig;
    } catch {
        return {};
    }
}

export async function setAlertMuteConfig(cfg: AlertMuteConfig): Promise<void> {
    await prisma.appConfig.upsert({
        where: { key: KEY },
        update: { value: JSON.stringify(cfg) },
        create: { key: KEY, value: JSON.stringify(cfg) },
    });
}

export async function isAlertMuted(serverId?: string | null): Promise<boolean> {
    const now = Date.now();
    const global = await getAlertMuteConfig();
    if (global.globalUntil) {
        const t = Date.parse(global.globalUntil);
        if (!Number.isNaN(t) && t > now) return true;
    }
    if (serverId) {
        const server = await prisma.server.findUnique({
            where: { id: serverId },
            select: { alertsMutedUntil: true },
        });
        if (server?.alertsMutedUntil && server.alertsMutedUntil.getTime() > now) return true;
    }
    return false;
}
