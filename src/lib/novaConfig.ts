import { prisma } from "./auth";
import { decrypt, encrypt } from "./encryption";

export const NOVA_CONFIG_KEY = "NOVA_CONFIG";

export type NovaTelegramConfig = {
    botToken: string;
    chatId: string;
    alertsEnabled: boolean;
    dailyReportEnabled: boolean;
    reportHour: number;
    thresholds: {
        memory: number;
        disk: number;
        dockerMemory: number;
        sslDays: number;
        backupMaxAgeHours: number;
    };
};

const DEFAULTS: NovaTelegramConfig = {
    botToken: "",
    chatId: "",
    alertsEnabled: true,
    dailyReportEnabled: true,
    reportHour: 9,
    thresholds: {
        memory: 90,
        disk: 90,
        dockerMemory: 85,
        sslDays: 15,
        backupMaxAgeHours: 36,
    },
};

type StoredNovaConfig = {
    botTokenEnc?: string;
    chatIdEnc?: string;
    alertsEnabled?: boolean;
    dailyReportEnabled?: boolean;
    reportHour?: number;
    thresholds?: NovaTelegramConfig["thresholds"];
};

function safeDecrypt(value?: string): string {
    if (!value) return "";
    try {
        return decrypt(value);
    } catch {
        return "";
    }
}

export async function getNovaConfig(): Promise<NovaTelegramConfig> {
    const row = await prisma.appConfig.findUnique({ where: { key: NOVA_CONFIG_KEY } });
    if (!row) return { ...DEFAULTS, thresholds: { ...DEFAULTS.thresholds } };

    let stored: StoredNovaConfig = {};
    try {
        stored = JSON.parse(row.value);
    } catch {
        stored = {};
    }

    return {
        botToken: safeDecrypt(stored.botTokenEnc),
        chatId: safeDecrypt(stored.chatIdEnc),
        alertsEnabled: stored.alertsEnabled ?? DEFAULTS.alertsEnabled,
        dailyReportEnabled: stored.dailyReportEnabled ?? DEFAULTS.dailyReportEnabled,
        reportHour: stored.reportHour ?? DEFAULTS.reportHour,
        thresholds: { ...DEFAULTS.thresholds, ...(stored.thresholds || {}) },
    };
}

/** Public view: never exposes raw secrets */
export async function getNovaConfigPublic() {
    const cfg = await getNovaConfig();
    return {
        hasBotToken: Boolean(cfg.botToken),
        hasChatId: Boolean(cfg.chatId),
        botTokenMasked: cfg.botToken ? `${cfg.botToken.slice(0, 6)}…` : "",
        chatIdMasked: cfg.chatId ? `${cfg.chatId.slice(0, 2)}…${cfg.chatId.slice(-2)}` : "",
        alertsEnabled: cfg.alertsEnabled,
        dailyReportEnabled: cfg.dailyReportEnabled,
        reportHour: cfg.reportHour,
        thresholds: cfg.thresholds,
    };
}

export async function saveNovaConfig(input: {
    botToken?: string;
    chatId?: string;
    alertsEnabled?: boolean;
    dailyReportEnabled?: boolean;
    reportHour?: number;
    thresholds?: Partial<NovaTelegramConfig["thresholds"]>;
}): Promise<void> {
    const current = await getNovaConfig();
    const next: NovaTelegramConfig = {
        botToken: input.botToken !== undefined && input.botToken !== "" ? input.botToken : current.botToken,
        chatId: input.chatId !== undefined && input.chatId !== "" ? input.chatId : current.chatId,
        alertsEnabled: input.alertsEnabled ?? current.alertsEnabled,
        dailyReportEnabled: input.dailyReportEnabled ?? current.dailyReportEnabled,
        reportHour: input.reportHour ?? current.reportHour,
        thresholds: { ...current.thresholds, ...(input.thresholds || {}) },
    };

    const stored: StoredNovaConfig = {
        botTokenEnc: next.botToken ? encrypt(next.botToken) : "",
        chatIdEnc: next.chatId ? encrypt(next.chatId) : "",
        alertsEnabled: next.alertsEnabled,
        dailyReportEnabled: next.dailyReportEnabled,
        reportHour: next.reportHour,
        thresholds: next.thresholds,
    };

    await prisma.appConfig.upsert({
        where: { key: NOVA_CONFIG_KEY },
        update: { value: JSON.stringify(stored) },
        create: { key: NOVA_CONFIG_KEY, value: JSON.stringify(stored) },
    });
}

/** Redact secrets from free-form logs before persisting/returning */
export function redactSecrets(text: string, secrets: string[] = []): string {
    let out = text || "";
    for (const secret of secrets) {
        if (secret && secret.length > 3) {
            out = out.split(secret).join("[REDACTED]");
        }
    }
    out = out.replace(/\d+:[A-Za-z0-9_-]{20,}/g, "[REDACTED_TOKEN]");
    return out;
}
