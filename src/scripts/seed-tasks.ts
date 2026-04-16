import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function addTasks() {
    const cleanupAlma = {
        name: "Mantenimiento VPS (AlmaLinux)",
        description: "Realiza limpieza de dnf, caché, rotación de logs de sistema y vaciado de temporales.",
        osTarget: "almalinux",
        commandTemplate: JSON.stringify([
            "echo '🔄 Iniciando...'",
            "df -h / | awk 'NR==2 {print \"Storage Start: \" $5}'",
            "dnf autoremove -y 2>&1",
            "dnf clean all 2>&1",
            "rm -rf /var/cache/dnf/* 2>/dev/null || true",
            "find /var/log -type f -name '*.gz' -delete",
            "find /var/log -type f -name '*.1' -delete",
            "truncate -s 0 /var/log/messages || true",
            "truncate -s 0 /var/log/secure || true",
            "truncate -s 0 /var/log/maillog || true",
            "rm -rf /tmp/* /var/tmp/* 2>/dev/null || true",
            "df -h / | awk 'NR==2 {print \"Storage End: \" $5}'",
            "echo '✅ Completado'"
        ])
    };

    const cleanupUbuntu = {
        name: "Mantenimiento VPS (Ubuntu/Debian)",
        description: "Limpieza profunda apt, journalctl, logs zip y cache.",
        osTarget: "ubuntu",
        commandTemplate: JSON.stringify([
            "echo '🔄 Iniciando limpieza Debian/Ubuntu...'",
            "df -h / | awk 'NR==2 {print \"Storage Start: \" $5}'",
            "DEBIAN_FRONTEND=noninteractive apt-get autoremove -y",
            "DEBIAN_FRONTEND=noninteractive apt-get clean",
            "rm -rf /var/lib/apt/lists/*",
            "journalctl --vacuum-time=3d",
            "find /var/log -type f -name '*.gz' -delete",
            "rm -rf /tmp/* /var/tmp/* 2>/dev/null || true",
            "df -h / | awk 'NR==2 {print \"Storage End: \" $5}'",
            "echo '✅ Completado'"
        ])
    };

    for (const t of [cleanupAlma, cleanupUbuntu]) {
        const exists = await prisma.remoteTask.findFirst({ where: { name: t.name } });
        if (!exists) {
            await prisma.remoteTask.create({ data: t });
            console.log(`Task ${t.name} added.`);
        }
    }

    console.log("Tasks seeded.");
}

addTasks().catch(console.error).finally(() => prisma.$disconnect());
