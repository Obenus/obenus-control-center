import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import * as bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

// Instancia global de Prisma
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
            },
            async authorize(credentials) {
                if (!credentials?.email || !credentials?.password) {
                    throw new Error("Credenciales incompletas");
                }

                const user = await prisma.user.findUnique({
                    where: { email: credentials.email.toLowerCase() },
                });

                // Respuesta uniforme ante usuario inexistente/inactivo/clave incorrecta
                // (mitiga enumeración de cuentas vía timing).
                const dummyHash = "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";
                const hashToCheck = user?.isActive ? user.passwordHash : dummyHash;
                const isValid = await bcrypt.compare(credentials.password, hashToCheck);

                if (!user || !user.isActive || !isValid) {
                    throw new Error("Usuario o contraseña incorrectos");
                }

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
    },
    secret: process.env.NEXTAUTH_SECRET,
};
