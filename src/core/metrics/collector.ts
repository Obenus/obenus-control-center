import { Server } from "@prisma/client";
import { executeSSHCommand } from "../ssh/sshService";

export async function fetchServerMetrics(server: Server) {
    const command = `
      echo "CPU:" $(top -bn1 | grep "Cpu(s)" | sed "s/.*, *\\([0-9.]*\\)%* id.*/\\1/" | awk '{print 100 - $1}')"%"
      echo "RAM:" $(free -m | awk '/Mem:/ { printf("%3.1f%%", $3/$2*100) }')
      echo "DISK:" $(df -h / | awk '/\\// {print $(NF-1)}')
    `;

    const { stdout, code } = await executeSSHCommand(server, command);
    if (code !== 0) throw new Error("SSH command failed for metrics");

    let cpu = 0, ram = 0, disk = 0;
    stdout.split("\n").forEach(line => {
        if (line.startsWith("CPU:")) cpu = parseFloat(line.replace("CPU:", "").trim().replace("%", ""));
        if (line.startsWith("RAM:")) ram = parseFloat(line.replace("RAM:", "").trim().replace("%", ""));
        if (line.startsWith("DISK:")) disk = parseFloat(line.replace("DISK:", "").trim().replace("%", ""));
    });

    return { cpu, ram, disk };
}
