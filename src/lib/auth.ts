import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import * as bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { rateLimit } from "./rateLimit";
import { decryptTotpSecret, verifyTotp } from "./totp";
import { logAudit } from "./audit";
import { isTrustedDevice, parseCookieHeader, TRUST_COOKIE } from "./trustedDevice";

declare global {
    var prisma: PrismaClient | undefined;
}

export const prisma = global.prisma || new PrismaClient();
if (process.env.NODE_ENV !== "production") global.prisma = prisma;

export const authOptions: NextAuthOptions = {
    providers: [
        CredentialsProvider({
            name: "Credenciales",
            credentials: {
                email: { label: "Email", type: "email" },
                password: { label: "Contraseña", type: "password" },
                totp: { label: "Código 2FA", type: "text" },
                rememberDevice: { label: "Recordar dispositivo", type: "text" },
            },
            async authorize(credentials, req) {
                if (!credentials?.email || !credentials?.password) {
                    throw new Error("Credenciales incompletas");
                }

                const email = credentials.email.toLowerCase().trim();
                const ip =
                    (req as any)?.headers?.["x-forwarded-for"]?.toString?.().split(",")[0]?.trim() ||
                    "unknown";
                const cookieHeader =
                    (req as any)?.headers?.cookie?.toString?.() ||
                    (req as any)?.headers?.get?.("cookie") ||
                    "";

                const rlIp = rateLimit(`login:ip:${ip}`, { limit: 20, windowMs: 15 * 60_000 });
                const rlEmail = rateLimit(`login:email:${email}`, { limit: 10, windowMs: 15 * 60_000 });
                if (!rlIp.ok || !rlEmail.ok) {
                    throw new Error(
                        `Demasiados intentos. Espera ${Math.max(rlIp.retryAfterSec, rlEmail.retryAfterSec)}s`
                    );
                }

                const user = await prisma.user.findUnique({
                    where: { email },
                });

                const dummyHash = "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";
                const hashToCheck = user?.isActive ? user.passwordHash : dummyHash;
                const isValid = await bcrypt.compare(credentials.password, hashToCheck);

                if (!user || !user.isActive || !isValid) {
                    await logAudit(user?.id || null, "LOGIN_FAILED", "User", user?.id, email, ip);
                    throw new Error("Usuario o contraseña incorrectos");
                }

                let trustedSkip = false;
                if (user.totpEnabled && user.totpSecretEnc) {
                    const trustToken = parseCookieHeader(cookieHeader, TRUST_COOKIE);
                    trustedSkip = await isTrustedDevice(user.id, trustToken);

                    if (!trustedSkip) {
                        const code = String(credentials.totp || "").trim();
                        if (!code) {
                            throw new Error("Se requiere código 2FA");
                        }
                        let secret: string;
                        try {
                            secret = decryptTotpSecret(user.totpSecretEnc);
                        } catch {
                            throw new Error("Configuración 2FA inválida");
                        }
                        if (!verifyTotp(secret, code)) {
                            await logAudit(user.id, "LOGIN_FAILED_2FA", "User", user.id, email, ip);
                            throw new Error("Código 2FA incorrecto");
                        }
                    }
                }

                await logAudit(
                    user.id,
                    trustedSkip ? "LOGIN_OK_TRUSTED_DEVICE" : "LOGIN_OK",
                    "User",
                    user.id,
                    email,
                    ip
                );

                return {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    role: user.role,
                };
            },
        }),
    ],
    callbacks: {
        async jwt({ token, user }) {
            if (user) {
                token.role = (user as any).role;
                token.id = user.id;
            }
            return token;
        },
        async session({ session, token }) {
            if (session.user) {
                (session.user as any).role = token.role;
                (session.user as any).id = token.id;
            }
            return session;
        },
    },
    pages: {
        signIn: "/login",
    },
    session: {
        strategy: "jwt",
        maxAge: 12 * 60 * 60, // 12h
    },
    secret: process.env.NEXTAUTH_SECRET,
};
