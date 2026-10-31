import { NextResponse } from "next/server";
import { prisma } from "@/lib/auth";
import { requireSession } from "@/lib/access";
import { logAudit } from "@/lib/audit";
import {
    decryptTotpSecret,
    encryptTotpSecret,
    generateTotpSecret,
    totpUri,
    verifyTotp,
} from "@/lib/totp";

export async function GET() {
    const auth = await requireSession();
    if (auth.error) return auth.error;
    const user = await prisma.user.findUnique({ where: { id: auth.user.id } });
    return NextResponse.json({
        enabled: Boolean(user?.totpEnabled),
    });
}

/** Inicia setup: genera secreto y URI (aún no activa 2FA). */
export async function POST(req: Request) {
    const auth = await requireSession();
    if (auth.error) return auth.error;
    const body = await req.json().catch(() => ({}));
    const action = body.action || "setup";

    if (action === "setup") {
        const secret = generateTotpSecret();
        const enc = encryptTotpSecret(secret);
        await prisma.user.update({
            where: { id: auth.user.id },
            data: { totpSecretEnc: enc, totpEnabled: false },
        });
        const email = auth.user.email || "user";
        return NextResponse.json({
            secret,
            otpauthUrl: totpUri(secret, email),
        });
    }

    if (action === "enable") {
        const code = String(body.code || "").trim();
        const user = await prisma.user.findUnique({ where: { id: auth.user.id } });
        if (!user?.totpSecretEnc) {
            return NextResponse.json({ error: "Primero inicia el setup 2FA" }, { status: 400 });
        }
        const secret = decryptTotpSecret(user.totpSecretEnc);
        if (!verifyTotp(secret, code)) {
            return NextResponse.json({ error: "Código incorrecto" }, { status: 400 });
        }
        await prisma.user.update({
            where: { id: auth.user.id },
            data: { totpEnabled: true },
        });
        await logAudit(auth.user.id, "ENABLE_2FA", "User", auth.user.id, "2FA activado");
        return NextResponse.json({ success: true, enabled: true });
    }

    if (action === "disable") {
        const code = String(body.code || "").trim();
        const password = String(body.password || "");
        const user = await prisma.user.findUnique({ where: { id: auth.user.id } });
        if (!user) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
        if (user.totpEnabled && user.totpSecretEnc) {
            const secret = decryptTotpSecret(user.totpSecretEnc);
            if (!verifyTotp(secret, code)) {
                return NextResponse.json({ error: "Código 2FA incorrecto" }, { status: 400 });
            }
        }
        const bcrypt = await import("bcryptjs");
        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) return NextResponse.json({ error: "Contraseña incorrecta" }, { status: 400 });
        await prisma.user.update({
            where: { id: auth.user.id },
            data: { totpEnabled: false, totpSecretEnc: null },
        });
        await logAudit(auth.user.id, "DISABLE_2FA", "User", auth.user.id, "2FA desactivado");
        return NextResponse.json({ success: true, enabled: false });
    }

    return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
}
