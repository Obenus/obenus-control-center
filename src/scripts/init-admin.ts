import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function init() {
    console.log('Initializing admin user...');
    const email = process.env.ADMIN_EMAIL || 'admin@obenus.local';
    const plainPassword = process.env.ADMIN_PASSWORD || 'ObeAdmin2026!';
    const name = process.env.ADMIN_NAME || 'Administrador Principal';

    const existingAdmin = await prisma.user.findFirst({
        where: { role: 'ADMIN' },
    });

    if (existingAdmin) {
        console.log('An admin user already exists. Skipping initialization.');
        return;
    }

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(plainPassword, saltRounds);

    await prisma.user.create({
        data: {
            name,
            email,
            passwordHash,
            role: 'ADMIN',
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
