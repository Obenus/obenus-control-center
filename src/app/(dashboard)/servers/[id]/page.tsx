"use client";

import { useEffect, useState, use } from "react";
import { ArrowLeft, Terminal, Activity, Trash2, Cpu, HardDrive, Network, Play, Box, RotateCw, PauseCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';
import { Bell, Zap, Sliders, History } from "lucide-react";

export default function ServerDetailsPage({ params }: { params: Promise<{ id: string }> }) {
    const router = useRouter();
    const { id } = use(params);
    const [server, setServer] = useState<any>(null);
    const [logs, setLogs] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [taskRunning, setTaskRunning] = useState<string | null>(null);
    const [metrics, setMetrics] = useState<any>(null);
    const [loadingMetrics, setLoadingMetrics] = useState(true);
    const [remoteTasks, setRemoteTasks] = useState<any[]>([]);
    const [schedules, setSchedules] = useState<any[]>([]);
    const [scheduleCrons, setScheduleCrons] = useState<Record<string, string>>({});
    const [customCrons, setCustomCrons] = useState<Record<string, string>>({});
    const [containers, setContainers] = useState<any[]>([]);
    const [loadingContainers, setLoadingContainers] = useState(true);
    const [containerError, setContainerError] = useState<string | null>(null);
    const [isScheduling, setIsScheduling] = useState<string | null>(null);
    const [history, setHistory] = useState<any[]>([]);
    const [triggers, setTriggers] = useState<any[]>([]);
    const [newTrigger, setNewTrigger] = useState({ metric: 'CPU', condition: 'GT', threshold: 90, actionTaskName: '' });
    const [isAddingTrigger, setIsAddingTrigger] = useState(false);

    const fetchServer = async () => {
        const res = await fetch(`/api/servers/${id}`);
        if (res.ok) {
            const s = await res.json();
            setServer(s);
            const tReq = await fetch(`/api/tasks?os=${s.os}`);
            if (tReq.ok) setRemoteTasks(await tReq.json());

            const schReq = await fetch(`/api/servers/${id}/tasks/schedule`);
            if (schReq.ok) setSchedules(await schReq.json());
            
            const histReq = await fetch(`/api/servers/${id}/metrics/history`);
            if (histReq.ok) setHistory(await histReq.json());

            const trigReq = await fetch(`/api/servers/${id}/triggers`);
            if (trigReq.ok) setTriggers(await trigReq.json());

            const dockerReq = await fetch(`/api/servers/${id}/docker`);
            if (dockerReq.ok) {
                const data = await dockerReq.json();
                if (data.error) setContainerError(data.error);
                else setContainers(data || []);
            } else {
                setContainerError("No se pudo conectar con Docker.");
            }
            setLoadingContainers(false);
        }
    };

    const fetchLogs = async () => {
        const res = await fetch(`/api/servers/${id}/tasks`);
        if (res.ok) setLogs(await res.json());
    };

    const addSchedule = async (taskName: string) => {
        setIsScheduling(taskName);
        const sc = scheduleCrons[taskName] || "never";
        const cc = customCrons[taskName] || "0 * * * *";
        const finalCron = sc === "custom" ? cc : sc;

        await fetch(`/api/servers/${id}/tasks/schedule`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ taskName, cron: finalCron })
        });
        const schReq = await fetch(`/api/servers/${id}/tasks/schedule`);
        if (schReq.ok) setSchedules(await schReq.json());
        setIsScheduling(null);
    };

    const deleteSchedule = async (key: string) => {
        await fetch(`/api/servers/${id}/tasks/schedule`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key })
        });
        const schReq = await fetch(`/api/servers/${id}/tasks/schedule`);
        if (schReq.ok) setSchedules(await schReq.json());
    };

    const handleDockerAction = async (action: string, containerId: string) => {
        setLoadingContainers(true);
        await fetch(`/api/servers/${id}/docker`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action, containerId })
        });
        const dockerReq = await fetch(`/api/servers/${id}/docker`);
        if (dockerReq.ok) {
            const data = await dockerReq.json();
            if (!data.error) setContainers(data);
        }
        setLoadingContainers(false);
    };

    const addTrigger = async () => {
        setIsAddingTrigger(true);
        const res = await fetch(`/api/servers/${id}/triggers`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(newTrigger)
        });
        if (res.ok) {
            const tReq = await fetch(`/api/servers/${id}/triggers`);
            if (tReq.ok) setTriggers(await tReq.json());
            setNewTrigger({ ...newTrigger, actionTaskName: '' });
        }
        setIsAddingTrigger(false);
    };

    const deleteTrigger = async (tid: string) => {
        await fetch(`/api/servers/${id}/triggers?id=${tid}`, { method: "DELETE" });
        setTriggers(triggers.filter(t => t.id !== tid));
    };

    const fetchMetrics = async () => {
        setLoadingMetrics(true);
        const res = await fetch(`/api/servers/${id}/metrics`);
        if (res.ok) setMetrics(await res.json());
        setLoadingMetrics(false);
    };

    useEffect(() => {
        Promise.all([fetchServer(), fetchLogs(), fetchMetrics()]).then(() => setLoading(false));
    }, [id]);

    const runTask = async (taskName: string) => {
        setTaskRunning(taskName);
        const res = await fetch(`/api/servers/${id}/tasks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskName })
        });
        if (res.ok) {
            await fetchLogs();
        }
        setTaskRunning(null);
    };

    const handleDelete = async () => {
        if (confirm("¿Seguro que deseas eliminar este servidor?")) {
            await fetch(`/api/servers/${id}`, { method: 'DELETE' });
            router.push("/servers");
        }
    };

    if (loading) {
        return (
            <div className="flex justify-center items-center h-[50vh]">
                <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
            </div>
        );
    }

    if (!server) {
        return <div className="p-8 text-white">Servidor no encontrado o sin acceso.</div>;
    }

    // Removed defaultTasks

    return (
        <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in duration-500">
            <div className="flex items-center gap-4">
                <Link href="/servers" className="p-2 bg-slate-900 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors shadow-sm">
                    <ArrowLeft className="w-5 h-5" />
                </Link>
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-white mb-1 flex items-center gap-3">
                        {server.name}
                        <span className="px-2.5 py-0.5 text-[10px] uppercase font-bold tracking-widest bg-emerald-500/10 text-emerald-400 rounded-full border border-emerald-500/20">
                            {server.status}
                        </span>
                    </h1>
                    <p className="text-slate-400 text-sm font-mono flex items-center gap-2">
                        <span className="text-indigo-400">{server.ip}</span> &middot; {server.os.toUpperCase()} &middot; SSH PORT {server.sshPort}
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-6">
                    <div className="glassmorphism rounded-2xl p-6 border border-white/5 shadow-2xl relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 blur-[80px] pointer-events-none rounded-full" />
                        <h2 className="text-lg font-semibold text-white mb-6 flex items-center gap-2">
                            <Activity className="w-5 h-5 text-indigo-400" /> Monitorización en Tiempo Real
                        </h2>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 relative z-10">
                            <div className="p-5 bg-slate-950/50 rounded-2xl border border-white/5 backdrop-blur-sm shadow-inner shadow-white/5">
                                <Cpu className="w-6 h-6 text-blue-400 mb-3" />
                                <div className="text-3xl font-bold text-white tracking-tighter mb-1">{loadingMetrics ? "..." : metrics?.cpu || "N/A"}</div>
                                <div className="text-[11px] text-slate-500 uppercase tracking-widest font-semibold flex justify-between">
                                    <span>Uso CPU</span>
                                </div>
                            </div>
                            <div className="p-5 bg-slate-950/50 rounded-2xl border border-white/5 backdrop-blur-sm shadow-inner shadow-white/5">
                                <HardDrive className="w-6 h-6 text-emerald-400 mb-3" />
                                <div className="text-3xl font-bold text-white tracking-tighter mb-1">{loadingMetrics ? "..." : metrics?.ram || "N/A"}</div>
                                <div className="text-[11px] text-slate-500 uppercase tracking-widest font-semibold flex justify-between">
                                    <span>Uso RAM</span>
                                </div>
                            </div>
                            <div className="p-5 bg-slate-950/50 rounded-2xl border border-white/5 backdrop-blur-sm shadow-inner shadow-white/5">
                                <Network className="w-6 h-6 text-purple-400 mb-3" />
                                <div className="text-3xl font-bold text-white tracking-tighter mb-1">{loadingMetrics ? "..." : metrics?.disk || "N/A"}</div>
                                <div className="text-[11px] text-slate-500 uppercase tracking-widest font-semibold flex justify-between">
                                    <span>Disco (/)</span>
                                </div>
                            </div>
                        </div>
                        <p className="text-[10px] text-emerald-500 mt-6 text-center tracking-wider max-w-sm mx-auto shadow-emerald-500/20 font-bold">
                            ✓ Sensor de métricas en tiempo real activo vía SSH.
                        </p>
                    </div>

                    <div className="glassmorphism rounded-2xl border border-white/5 overflow-hidden shadow-2xl">
                        <div className="p-6 border-b border-white/5 bg-black/20 flex items-center justify-between">
                            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                                <Box className="w-5 h-5 text-sky-400" /> Docker Deck (Contenedores)
                            </h2>
                        </div>
                        <div className="p-0">
                            {loadingContainers ? (
                                <p className="p-8 text-center text-slate-500 animate-pulse text-sm">Escaneando motor Docker...</p>
                            ) : containerError ? (
                                <p className="p-8 text-center text-slate-500 text-sm border-dashed border border-slate-800 m-4 rounded-xl mix-blend-screen">{containerError}</p>
                            ) : containers.length === 0 ? (
                                <p className="p-8 text-center text-slate-500 text-sm border-dashed border border-slate-800 m-4 rounded-xl mix-blend-screen">No hay contenedores lanzados en el nodo.</p>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left whitespace-nowrap">
                                        <thead>
                                            <tr className="border-b border-white/5 bg-white/[0.01]">
                                                <th className="px-6 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Name</th>
                                                <th className="px-6 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest">ID</th>
                                                <th className="px-6 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Status</th>
                                                <th className="px-6 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-right">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {containers.map(c => (
                                                <tr key={c.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                                                    <td className="py-4 px-6 text-sm font-semibold text-white font-display tracking-wide">{c.name}</td>
                                                    <td className="py-4 px-6 text-xs text-slate-500 font-mono tracking-tight">{c.id}</td>
                                                    <td className="py-4 px-6">
                                                        <span className={`px-2 py-1 text-[10px] font-bold tracking-widest uppercase rounded-full border ${c.state === 'running' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 shadow-[0_0_10px_rgba(16,185,129,0.2)]' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
                                                            {c.state}
                                                        </span>
                                                        <span className="ml-2 text-[10px] text-slate-500 hidden sm:inline-block">{c.status}</span>
                                                    </td>
                                                    <td className="py-4 px-6">
                                                        <div className="flex justify-end gap-2">
                                                            {c.state === 'running' ? (
                                                                <>
                                                                    <button onClick={() => handleDockerAction('restart', c.id)} className="p-2 rounded bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 transition-colors tooltip" title="Restart">
                                                                        <RotateCw className="w-4 h-4" />
                                                                    </button>
                                                                    <button onClick={() => handleDockerAction('stop', c.id)} className="p-2 rounded bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-colors tooltip" title="Stop">
                                                                        <PauseCircle className="w-4 h-4" />
                                                                    </button>
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <button onClick={() => handleDockerAction('start', c.id)} className="p-2 rounded bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 transition-colors tooltip" title="Start">
                                                                        <Play className="w-4 h-4" />
                                                                    </button>
                                                                    <button onClick={() => handleDockerAction('rm', c.id)} className="p-2 rounded bg-red-500/10 hover:bg-red-500/20 text-red-500 transition-colors tooltip" title="Remove">
                                                                        <Trash2 className="w-4 h-4" />
                                                                    </button>
                                                                </>
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="glassmorphism rounded-2xl border border-white/5 overflow-hidden shadow-2xl">
                        <div className="p-6 border-b border-white/5 bg-black/20 flex items-center justify-between">
                            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                                <Terminal className="w-5 h-5 text-slate-400" /> Tareas Ejecutadas Recientemente
                            </h2>
                        </div>
                        <table className="w-full text-left">
                            <tbody>
                                {logs.length === 0 && <tr><td className="p-8 text-center text-slate-500">Aún no hay ejecuciones.</td></tr>}
                                {logs.map((log: any) => (
                                    <tr key={log.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                                        <td className="py-4 px-6 text-sm font-semibold text-slate-200 tracking-tight">{log.taskName}</td>
                                        <td className="py-4 px-6 text-xs text-slate-500 font-mono tracking-tight">{new Date(log.startedAt).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })}</td>
                                        <td className="py-4 px-6 text-xs font-mono text-right">
                                            <span className={`px-2 py-1 rounded border overflow-hidden truncate ${log.exitCode === 0 ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400' : 'border-red-500/20 bg-red-500/10 text-red-400'
                                                }`}>
                                                Exit {log.exitCode} ({log.durationMs}ms)
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div className="space-y-6">
                    <div className="glassmorphism rounded-2xl p-6 border border-white/5 shadow-2xl relative overflow-hidden">
                        <h2 className="text-lg font-semibold text-white mb-6 flex items-center gap-2">
                            <History className="w-5 h-5 text-sky-400" /> Historial de Telemetría (24h)
                        </h2>
                        <div className="h-64 mt-4 w-full">
                            {history.length > 0 ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={history}>
                                        <defs>
                                            <linearGradient id="colorCpu" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                                                <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" vertical={false} />
                                        <XAxis dataKey="time" stroke="#475569" fontSize={10} tickLine={false} axisLine={false} />
                                        <YAxis stroke="#475569" fontSize={10} tickLine={false} axisLine={false} domain={[0, 100]} />
                                        <Tooltip 
                                            contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '12px', fontSize: '10px' }}
                                            itemStyle={{ color: '#fff' }}
                                        />
                                        <Area type="monotone" dataKey="cpu" name="CPU %" stroke="#6366f1" fillOpacity={1} fill="url(#colorCpu)" strokeWidth={2} />
                                        <Area type="monotone" dataKey="ram" name="RAM %" stroke="#10b981" fillOpacity={0} strokeWidth={2} />
                                    </AreaChart>
                                </ResponsiveContainer>
                            ) : (
                                <div className="h-full flex flex-col items-center justify-center text-slate-500 text-sm">
                                    <Activity className="w-8 h-8 mb-2 opacity-20" />
                                    No hay datos históricos suficientes.
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="glassmorphism rounded-2xl p-6 border border-white/5 shadow-2xl">
                        <div className="flex items-center justify-between mb-6">
                            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                                <Zap className="w-5 h-5 text-amber-400" /> Disparadores Sensoriales (Auto-Action)
                            </h2>
                        </div>
                        
                        <div className="space-y-4">
                            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 p-4 bg-white/[0.02] border border-white/5 rounded-xl items-end">
                                <div>
                                    <label className="text-[10px] uppercase font-bold text-slate-500 mb-1 block">Métrica</label>
                                    <select value={newTrigger.metric} onChange={e => setNewTrigger({...newTrigger, metric: e.target.value})} className="bg-black/50 border border-white/10 text-xs px-3 py-2 rounded-lg text-slate-300 w-full outline-none focus:border-indigo-500">
                                        <option value="CPU">Uso de CPU</option>
                                        <option value="RAM">Uso de RAM</option>
                                        <option value="DISK">Uso de Disco</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="text-[10px] uppercase font-bold text-slate-500 mb-1 block">Si es &gt;</label>
                                    <input type="number" value={newTrigger.threshold} onChange={e => setNewTrigger({...newTrigger, threshold: parseInt(e.target.value)})} className="bg-black/50 border border-white/10 text-xs px-3 py-2 rounded-lg text-slate-300 w-full outline-none focus:border-indigo-500" />
                                </div>
                                <div>
                                    <label className="text-[10px] uppercase font-bold text-slate-500 mb-1 block">Ejecutar Script</label>
                                    <select value={newTrigger.actionTaskName} onChange={e => setNewTrigger({...newTrigger, actionTaskName: e.target.value})} className="bg-black/50 border border-white/10 text-xs px-3 py-2 rounded-lg text-slate-300 w-full outline-none focus:border-indigo-500">
                                        <option value="">-- Elige Tarea --</option>
                                        {remoteTasks.map(rt => <option key={rt.id} value={rt.name}>{rt.name}</option>)}
                                    </select>
                                </div>
                                <button 
                                    onClick={addTrigger}
                                    disabled={!newTrigger.actionTaskName || isAddingTrigger}
                                    className="bg-indigo-500 text-white font-bold py-2 rounded-lg text-xs hover:bg-indigo-600 transition-colors disabled:opacity-50"
                                >
                                    {isAddingTrigger ? '...' : 'Crear Regla'}
                                </button>
                            </div>

                            <div className="space-y-2">
                                {triggers.length === 0 && <p className="text-center text-slate-600 text-xs py-4">No hay sensores autónomos configurados.</p>}
                                {triggers.map(trig => (
                                    <div key={trig.id} className="flex items-center justify-between p-3 rounded-lg border border-white/5 bg-white/[0.01]">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center">
                                                <Zap className="w-4 h-4 text-indigo-400" />
                                            </div>
                                            <div>
                                                <p className="text-xs text-white">Si <span className="text-indigo-400">{trig.metric}</span> es {trig.condition === 'GT' ? '>' : '<'} <span className="text-indigo-400">{trig.threshold}%</span></p>
                                                <p className="text-[10px] text-slate-500">Lanzar: <span className="text-slate-300 font-mono italic">{trig.actionTaskName}</span></p>
                                            </div>
                                        </div>
                                        <button onClick={() => deleteTrigger(trig.id)} className="text-slate-600 hover:text-red-400 transition-colors p-2">
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="glassmorphism rounded-2xl p-6 border border-white/5 shadow-2xl">
                        <h2 className="text-lg font-semibold text-white mb-5 flex items-center gap-2">
                            <Play className="w-4 h-4 text-indigo-400 fill-indigo-400" /> Acciones Rápidas
                        </h2>
                        <div className="space-y-2">
                            {remoteTasks.length === 0 && <p className="text-slate-500 text-sm p-4 text-center">No hay tareas para este OS.</p>}
                            {remoteTasks.map(t => (
                                <button
                                    key={t.id}
                                    disabled={taskRunning === t.name}
                                    onClick={() => runTask(t.name)}
                                    className="w-full text-left px-5 py-3.5 rounded-xl bg-slate-900/50 border border-slate-800 hover:border-indigo-500/50 hover:bg-indigo-500/10 transition-all flex items-center justify-between text-slate-300 hover:text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                                    title={t.description}
                                >
                                    <div className="flex flex-col">
                                        <span className="tracking-tight mb-1">{t.name}</span>
                                        <div className="flex flex-wrap gap-2 relative z-20 items-center mt-2 group justify-end sm:justify-start" onClick={e => e.stopPropagation()}>
                                            <select
                                                value={scheduleCrons[t.name] || "never"}
                                                onChange={e => setScheduleCrons({ ...scheduleCrons, [t.name]: e.target.value })}
                                                className="bg-black/50 border border-white/10 text-[10px] sm:text-xs px-2 sm:px-3 py-1.5 rounded-lg text-slate-300 font-mono focus:border-indigo-500 outline-none hover:bg-black/80 transition-colors cursor-pointer w-full sm:w-auto"
                                            >
                                                <option value="never">-- Nunca (Desactivado) --</option>
                                                <option value="0 0 * * *">Diariamente (00:00)</option>
                                                <option value="0 0 * * 0">Cada Domingo (00:00)</option>
                                                <option value="0 0 1 * *">1er Día del Mes</option>
                                                <option value="0 */12 * * *">Cada 12 Horas</option>
                                                <option value="custom">Avanzado (Cron)</option>
                                            </select>

                                            {(scheduleCrons[t.name] || "never") === "custom" && (
                                                <input type="text" placeholder="0 * * * *" value={customCrons[t.name] || "0 * * * *"} onChange={e => setCustomCrons({ ...customCrons, [t.name]: e.target.value })} className="bg-black/50 border border-white/10 text-[10px] w-full sm:w-24 px-2 py-1.5 rounded-lg text-slate-300 font-mono focus:border-indigo-500 outline-none" title="Formato Cron Avanzado" />
                                            )}

                                            <button onClick={() => addSchedule(t.name)} disabled={isScheduling === t.name || (scheduleCrons[t.name] || "never") === "never"} className="bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 text-[10px] px-3 py-1.5 rounded-lg hover:bg-indigo-500/40 transition-colors font-bold tracking-wide disabled:opacity-50 disabled:cursor-not-allowed w-full sm:w-auto">
                                                {isScheduling === t.name ? "..." : "Programar"}
                                            </button>
                                        </div>
                                    </div>
                                    {taskRunning === t.name ? (
                                        <div className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                                    ) : (
                                        <ArrowLeft className="w-4 h-4 text-slate-600 transition-colors rotate-180" />
                                    )}
                                </button>
                            ))}
                        </div>

                        {schedules.length > 0 && (
                            <div className="mt-8 space-y-2">
                                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Rutinas Programadas</h3>
                                {schedules.map(sch => (
                                    <div key={sch.key} className="flex items-center justify-between px-4 py-3 bg-indigo-500/5 border border-indigo-500/10 rounded-xl">
                                        <div>
                                            <p className="text-xs font-bold text-indigo-300 tracking-tight">{sch.taskName}</p>
                                            <p className="text-[10px] font-mono text-slate-500 mt-1">Cron: {sch.cron} • Próximo: {new Date(sch.next).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })}</p>
                                        </div>
                                        <button onClick={() => deleteSchedule(sch.key)} className="text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 px-2 py-1 rounded transition-colors border border-transparent hover:border-red-500/20">Eliminar</button>
                                    </div>
                                ))}
                            </div>
                        )}

                        <div className="mt-8 pt-6 border-t border-slate-800/80">
                            <button onClick={handleDelete} className="w-full py-3 rounded-xl bg-red-500/10 hover:bg-red-500 shadow-xl shadow-red-500/5 text-red-500 hover:text-white text-sm font-semibold border border-red-500/20 hover:border-transparent transition-all flex items-center justify-center gap-2">
                                <Trash2 className="w-4 h-4" /> Eliminar Servidor
                            </button>
                            <p className="text-[10px] text-center text-slate-600 mt-3 font-medium uppercase tracking-wider">Acción Irreversible</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
