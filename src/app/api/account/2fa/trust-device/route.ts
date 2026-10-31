import { NextResponse } from "next/server";
import { requireSession } from "@/lib/access";
import { prisma } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { decryptTotpSecret, verifyTotp } from "@/lib/totp";
import {
    createTrustedDevice,
    trustCookieHeader,
    TRUST_DAYS,
} from "@/lib/trustedDevice";

/** Registra este navegador como de confianza 30 días (exige código 2FA válido). */
export async function POST(req: Request) {
    const auth = await requireSession();
    if (auth.error) return auth.error;

    const user = await prisma.user.findUnique({ where: { id: auth.user.id } });
    if (!user?.totpEnabled || !user.totpSecretEnc) {
        return NextResponse.json(
            { error: "2FA no está activo; no hay nada que recordar" },
            { status: 400 }
        );
    }

    const body = await req.json().catch(() => ({}));
    const code = String(body.code || "").trim();
    if (!code) {
        return NextResponse.json({ error: "Se requiere el código 2FA para recordar el dispositivo" }, { status: 400 });
    }

    let secret: string;
    try {
        secret = decryptTotpSecret(user.totpSecretEnc);
    } catch {
        return NextResponse.json({ error: "Configuración 2FA inválida" }, { status: 400 });
    }
    if (!verifyTotp(secret, code)) {
        return NextResponse.json({ error: "Código 2FA incorrecto" }, { status: 400 });
    }

    const ua = req.headers.get("user-agent") || "";
    const { token } = await createTrustedDevice(auth.user.id, ua);
    const secure =
        process.env.NEXTAUTH_URL?.startsWith("https://") ||
        req.headers.get("x-forwarded-proto") === "https";

    await logAudit(
        auth.user.id,
        "TRUST_DEVICE",
        "User",
        auth.user.id,
        `Dispositivo recordado ${TRUST_DAYS} días`,
        req.headers.get("x-forwarded-for") || undefined
    );

    const res = NextResponse.json({
        success: true,
        days: TRUST_DAYS,
        message: `Este dispositivo no pedirá 2FA durante ${TRUST_DAYS} días`,
    });
    res.headers.set("Set-Cookie", trustCookieHeader(token, secure));
    return res;
}
