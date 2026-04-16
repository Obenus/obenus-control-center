import { Server, Activity, AlertTriangle, CheckCircle2, ChevronRight } from "lucide-react";
import { getServerSession } from "next-auth";
import { authOptions, prisma } from "@/lib/auth";
import Link from "next/link";

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as any)?.id;
    const role = (session?.user as any)?.role;

    const serverWhere = role === "ADMIN" ? {} : { userId };
    const logWhere = role === "ADMIN" ? {} : { userId };

    const serverCount = await prisma.server.count({ where: serverWhere });
    const tasksCount = await prisma.taskLog.count({ where: logWhere });
    const failedTasks = await prisma.taskLog.count({ where: { status: "ERROR", ...logWhere } });
    const okTasks = tasksCount - failedTasks;

    const recentLogs = await prisma.taskLog.findMany({
        orderBy: { startedAt: "desc" },
        take: 8,
        where: logWhere,
        include: { server: { select: { name: true } } }
    });

    const activeNodes = await prisma.server.findMany({
        where: serverWhere,
        orderBy: { name: "asc" }
    });

    const recentAudits = await prisma.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 5,
        where: logWhere
    });

    return (
        <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in duration-500">
            <div>
                <h1 className="text-3xl font-bold tracking-tight text-white mb-2 font-display">Dashboard</h1>
                <p className="text-slate-400">Resumen y estado global de la infraestructura gestionada.</p>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
                {[
                    { label: "Nodos Activos", value: serverCount.toString(), icon: Server, color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/20" },
                    { label: "Tareas Ejecutadas", value: tasksCount.toString(), icon: Activity, color: "text-indigo-400", bg: "bg-indigo-500/10 border-indigo-500/20" },
                    { label: "Alertas o Fallos", value: failedTasks.toString(), icon: AlertTriangle, color: "text-red-400", bg: "bg-red-500/10 border-red-500/20" },
                    { label: "Tareas Exitosas", value: okTasks.toString(), icon: CheckCircle2, color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
                ].map((stat, i) => (
                    <div key={i} className="glass-card animated-border p-6 rounded-2xl flex items-center justify-between group">
                        <div className="relative z-10">
                            <p className="text-xs font-bold uppercase tracking-widest text-slate-400/80 mb-1">{stat.label}</p>
                            <h3 className="text-4xl font-display font-semibold text-white tracking-tight">{stat.value}</h3>
                        </div>
                        <div className={`p-4 rounded-xl border ${stat.bg} relative z-10 shadow-inner group-hover:scale-110 transition-transform duration-300`}>
                            <stat.icon className={`w-6 h-6 outline-none ${stat.color} filter drop-shadow-lg`} />
                        </div>
                    </div>
                ))}
            </div>

            {/* Global Server Empire */}
            <div className="glass-card animated-border rounded-2xl p-6">
                <h2 className="text-lg font-semibold text-white mb-6 font-display relative z-10 flex items-center justify-between">
                    <span>Estado Global de Nodos</span>
                    <span className="text-xs bg-indigo-500/20 text-indigo-400 px-3 py-1 rounded-full border border-indigo-500/30">
                        {activeNodes.filter(n => n.status === "ACTIVE").length} / {activeNodes.length} Online
                    </span>
                </h2>

                {activeNodes.length === 0 ? (
                    <div className="flex items-center justify-center p-8 text-slate-500 text-sm bg-black/20 rounded-xl border border-slate-800/50 border-dashed relative z-10">
                        No hay servidores conectados a la flota.
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 relative z-10">
                        {activeNodes.map(node => (
                            <Link href={`/servers/${node.id}`} key={node.id} className="block group">
                                <div className="p-4 rounded-xl border border-white/5 bg-white/[0.01] hover:bg-white/[0.04] transition-all hover:border-sky-500/30 h-full flex items-center gap-4 relative overflow-hidden">
                                    <div className={`absolute top-0 right-0 w-24 h-24 blur-3xl opacity-20 group-hover:opacity-40 transition-opacity ${node.status === "ACTIVE" ? 'bg-emerald-500' : 'bg-red-500'}`} />

                                    <div className="relative">
                                        <div className={`w-3 h-3 rounded-full border border-black/50 shadow-md ${node.status === "ACTIVE" ? 'bg-emerald-500 animate-[pulse_2s_ease-in-out_infinite] shadow-[0_0_15px_rgba(16,185,129,0.5)]' : 'bg-red-500 shadow-[0_0_15px_rgba(239,68,68,0.5)]'}`} />
                                    </div>
                                    <div className="flex-1 overflow-hidden">
                                        <h4 className="text-sm font-bold text-white tracking-wide truncate group-hover:text-sky-400 transition-colors">{node.name}</h4>
                                        <p className="text-[10px] text-slate-500 font-mono mt-0.5 truncate">{node.ip}</p>
                                    </div>
                                    <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-sky-400 transition-colors" />
                                </div>
                            </Link>
                        ))}
                    </div>
                )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-6 gap-6">
                <div className="lg:col-span-4 glass-card animated-border rounded-2xl p-6 min-h-[400px]">
                    <div className="flex justify-between items-center mb-6 relative z-10">
                        <h2 className="text-lg font-semibold text-white font-display">Telescopetría de Tareas (SSH)</h2>
                        <Link href="/monitoring" className="text-xs text-sky-400 hover:text-sky-300 font-semibold tracking-wider uppercase flex items-center">
                            Ver Historial <ChevronRight className="w-3 h-3 ml-1" />
                        </Link>
                    </div>
                    <div className="relative z-10">
                        {recentLogs.length === 0 ? (
                            <div className="flex items-center justify-center h-[280px] text-slate-500 text-sm bg-black/20 rounded-xl border border-slate-800/50 border-dashed mix-blend-screen">
                                Ningún job remotizado todavía.
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {recentLogs.map(log => (
                                    <div key={log.id} className="flex items-center justify-between p-4 rounded-xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] transition-colors">
                                        <div className="flex items-center gap-4">
                                            <div className={`w-2 h-2 rounded-full ${log.status === 'SUCCESS' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]' : log.status === 'ERROR' ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]' : 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.8)]'}`} />
                                            <div>
                                                <p className="text-sm font-semibold text-white font-display tracking-wide">{log.taskName}</p>
                                                <p className="text-xs text-slate-400 mt-0.5">{log.server?.name || 'Nodo Removido'}</p>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-xs font-mono text-slate-500">{new Date(log.startedAt).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })}</p>
                                            <p className="text-[10px] uppercase font-bold tracking-widest text-slate-500 mt-1">{log.durationMs} ms</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                <div className="lg:col-span-2 glass-card animated-border rounded-2xl p-6 min-h-[400px]">
                    <h2 className="text-lg font-semibold text-white mb-6 font-display relative z-10">Auditoría Reciente</h2>
                    <div className="relative z-10">
                        {recentAudits.length === 0 ? (
                            <div className="flex items-center justify-center h-[280px] text-slate-500 text-sm bg-black/20 rounded-xl border border-slate-800/50 border-dashed mix-blend-screen">
                                Registro vacío.
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {recentAudits.map(audit => (
                                    <div key={audit.id} className="relative pl-6 border-l border-white/10 before:absolute before:left-[-5px] before:top-2 before:w-2.5 before:h-2.5 before:rounded-full before:bg-indigo-500/50 before:border before:border-indigo-400">
                                        <p className="text-[11px] uppercase tracking-widest text-sky-400 font-bold mb-1">{audit.action}</p>
                                        <p className="text-sm text-slate-300 font-medium">{audit.details}</p>
                                        <p className="text-xs font-mono text-slate-500 mt-1">{new Date(audit.createdAt).toLocaleDateString("es-ES", { timeZone: "Europe/Madrid" })}</p>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
