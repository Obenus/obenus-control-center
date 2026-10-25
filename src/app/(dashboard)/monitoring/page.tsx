import { getServerSession } from "next-auth";
import { authOptions, prisma } from "@/lib/auth";
import { ShieldAlert } from "lucide-react";
import TaskHistoryTable from "@/components/tasks/TaskHistoryTable";

export const dynamic = "force-dynamic";

export default async function MonitoringPage() {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as any)?.id;
    const role = (session?.user as any)?.role;

    const logWhere = role === "ADMIN" ? {} : { userId };

    const tasks = await prisma.taskLog.findMany({
        orderBy: { startedAt: "desc" },
        take: 30,
        where: logWhere,
        include: { server: { select: { name: true } } },
    });

    const audits = await prisma.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 30,
        where: logWhere,
    });

    const taskItems = tasks.map((task) => ({
        id: task.id,
        taskName: task.taskName,
        serverName: task.server?.name || "Eliminado",
        status: task.status,
        startedAt: task.startedAt.toISOString(),
        finishedAt: task.finishedAt?.toISOString() || null,
        durationMs: task.durationMs,
        exitCode: task.exitCode,
        stdout: task.stdout,
        stderr: task.stderr,
    }));

    return (
        <div className="max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500">
            <div>
                <h1 className="text-3xl font-bold tracking-tight text-white mb-2 font-display">Monitorización Global</h1>
                <p className="text-slate-400">
                    Log integral de telemetría remota (SSH) y registros de seguridad. Pulsa una tarea para ver el detalle.
                </p>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
                <div className="glass-card animated-border rounded-3xl p-8 relative">
                    <h2 className="text-xl font-bold text-white mb-6 relative z-10 flex items-center gap-2 font-display">
                        <span className="text-emerald-400 font-mono text-base">&gt;_</span> Historial de Tareas
                    </h2>
                    <TaskHistoryTable tasks={taskItems} />
                </div>

                <div className="glass-card animated-border rounded-3xl p-8 relative">
                    <h2 className="text-xl font-bold text-white mb-6 relative z-10 flex items-center gap-2 font-display">
                        <ShieldAlert className="w-5 h-5 text-indigo-400" /> Registro de Auditoría
                    </h2>
                    <div className="overflow-x-auto relative z-10">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="border-b border-white/10 text-[10px] uppercase tracking-widest text-slate-500">
                                    <th className="pb-4 font-bold">Acción</th>
                                    <th className="pb-4 font-bold">Detalles</th>
                                    <th className="pb-4 font-bold">IP</th>
                                    <th className="pb-4 font-bold text-right">Fecha</th>
                                </tr>
                            </thead>
                            <tbody className="text-sm">
                                {audits.length === 0 && (
                                    <tr>
                                        <td colSpan={4} className="py-12 text-center text-slate-600 font-mono text-xs uppercase tracking-widest">
                                            Sin registros
                                        </td>
                                    </tr>
                                )}
                                {audits.map((audit) => (
                                    <tr key={audit.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                                        <td className="py-4 pr-4 font-bold text-sky-400 tracking-wider text-[11px] uppercase">{audit.action}</td>
                                        <td className="py-4 pr-4 text-slate-300 max-w-[200px] truncate">{audit.details}</td>
                                        <td className="py-4 pr-4 text-slate-500 font-mono text-[10px] tracking-tight">{audit.ipAddress}</td>
                                        <td className="py-4 text-right text-slate-500 font-mono text-[10px] tracking-tight">
                                            {new Date(audit.createdAt).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
}
