import { NextResponse } from "next/server";
import * as bcrypt from "bcryptjs";
import { prisma } from "@/lib/auth";
import { requireAdmin } from "@/lib/access";
import { logAudit } from "@/lib/audit";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validatePassword(password: unknown): string | null {
    if (typeof password !== "string" || password.length < 10 || password.length > 200) {
        return "La contraseña debe tener entre 10 y 200 caracteres";
    }
    return null;
}

export async function GET() {
    const admin = await requireAdmin();
    if (admin.error) return admin.error;

    try {
        const users = await prisma.user.findMany({
            select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true },
            orderBy: { createdAt: "desc" },
        });
        return NextResponse.json(users);
    } catch {
        return new NextResponse("Internal Error", { status: 500 });
    }
}

export async function POST(req: Request) {
    const admin = await requireAdmin();
    if (admin.error) return admin.error;

    try {
        const { name, email, password, role } = await req.json();
        if (typeof name !== "string" || !name.trim() || name.length > 120) {
            return NextResponse.json({ error: "Nombre inválido" }, { status: 400 });
        }
        if (typeof email !== "string" || !EMAIL_RE.test(email)) {
            return NextResponse.json({ error: "Email inválido" }, { status: 400 });
        }
        const pwdErr = validatePassword(password);
        if (pwdErr) return NextResponse.json({ error: pwdErr }, { status: 400 });
        if (role && role !== "USER" && role !== "ADMIN") {
            return NextResponse.json({ error: "Rol inválido" }, { status: 400 });
        }

        const passwordHash = await bcrypt.hash(password, 12);
        const user = await prisma.user.create({
            data: {
                name: name.trim(),
                email: email.toLowerCase().trim(),
                passwordHash,
                role: role || "USER",
            },
            select: { id: true, name: true, email: true, role: true, isActive: true },
        });
        await logAudit(admin.user.id, "CREATE_USER", "User", user.id, `Creado usuario ${user.email}`, undefined);
        return NextResponse.json(user);
    } catch {
        return new NextResponse("Internal Error", { status: 500 });
    }
}

export async function PUT(req: Request) {
    const admin = await requireAdmin();
    if (admin.error) return admin.error;

    try {
        const body = await req.json();
        const { id, name, email, password, role } = body;
        if (typeof id !== "string" || !id) {
            return NextResponse.json({ error: "ID inválido" }, { status: 400 });
        }

        const dataToUpdate: Record<string, unknown> = {};
        if (name !== undefined) {
            if (typeof name !== "string" || !name.trim() || name.length > 120) {
                return NextResponse.json({ error: "Nombre inválido" }, { status: 400 });
            }
            dataToUpdate.name = name.trim();
        }
        if (email !== undefined) {
            if (typeof email !== "string" || !EMAIL_RE.test(email)) {
                return NextResponse.json({ error: "Email inválido" }, { status: 400 });
            }
            dataToUpdate.email = email.toLowerCase().trim();
        }
        if (role !== undefined) {
            if (role !== "USER" && role !== "ADMIN") {
                return NextResponse.json({ error: "Rol inválido" }, { status: 400 });
            }
            dataToUpdate.role = role;
        }
        if (password) {
            const pwdErr = validatePassword(password);
            if (pwdErr) return NextResponse.json({ error: pwdErr }, { status: 400 });
            dataToUpdate.passwordHash = await bcrypt.hash(password, 12);
        }

        const user = await prisma.user.update({
            where: { id },
            data: dataToUpdate,
            select: { id: true, name: true, email: true, role: true, isActive: true },
        });
        await logAudit(admin.user.id, "UPDATE_USER", "User", user.id, `Actualizado usuario ${user.email}`, undefined);
        return NextResponse.json(user);
    } catch {
        return new NextResponse("Internal Error", { status: 500 });
    }
}
