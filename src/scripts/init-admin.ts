import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function init() {
    console.log("Initializing admin user...");
    const email = process.env.ADMIN_EMAIL;
    const plainPassword = process.env.ADMIN_PASSWORD;
    const name = process.env.ADMIN_NAME || "Administrador Principal";

    if (!email || !plainPassword) {
        console.error("ADMIN_EMAIL and ADMIN_PASSWORD are required (no default credentials).");
        process.exit(1);
    }
    if (plainPassword.length < 12) {
        console.error("ADMIN_PASSWORD must be at least 12 characters.");
        process.exit(1);
    }

    const existingAdmin = await prisma.user.findFirst({
        where: { role: "ADMIN" },
    });

    if (existingAdmin) {
        console.log("An admin user already exists. Skipping initialization.");
        return;
    }

    const passwordHash = await bcrypt.hash(plainPassword, 12);

    await prisma.user.create({
        data: {
            name,
            email: email.toLowerCase(),
            passwordHash,
            role: "ADMIN",
            isActive: true,
        },
    });

    console.log(`Admin user created: ${email}`);
}

init()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
