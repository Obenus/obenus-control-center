"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Radar, RefreshCw } from "lucide-react";

type Props = { serverId: string; isAdmin: boolean };

export default function NovaServerPanel({ serverId, isAdmin }: Props) {
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState<string | null>(null);
    const [msg, setMsg] = useState<string | null>(null);
    const [modules, setModules] = useState({ linux: true, docker: false, plesk: false, s3: false });

    const load = useCallback(async () => {
        const res = await fetch(`/api/nova/servers/${serverId}`);
        if (res.ok) {
            const json = await res.json();
            setData(json);
            if (json.agent?.modules) setModules(json.agent.modules);
        }
        setLoading(false);
    }, [serverId]);

    useEffect(() => {
        load();
        const t = setInterval(load, 6000);
        return () => clearInterval(t);
    }, [load]);

    const action = async (name: string) => {
        if (!isAdmin) return;
        setBusy(name);
        setMsg(null);
        const res = await fetch("/api/nova/actions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: name, serverId, disableLegacy: name === "migrate" }),
        });
        setMsg(res.ok ? `Acción ${name} encolada` : "Error al encolar");
        setBusy(null);
        await load();
    };

    const saveModules = async () => {
        if (!isAdmin) return;
        setBusy("modules");
        await fetch(`/api/nova/servers/${serverId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ modules }),
        });
        setMsg("Módulos guardados y sincronización encolada");
        setBusy(null);
        await load();
    };

    if (loading) {
        return (
            <div className="glassmorphism rounded-2xl p-8 flex justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-sky-400" />
            </div>
        );
    }

    const agent = data?.agent;

    return (
        <div className="glassmorphism rounded-2xl border border-white/5 shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-white/5 bg-black/20 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                    <Radar className="w-5 h-5 text-sky-400" /> NOVA
                </h2>
                <button
                    onClick={() => action("refresh")}
                    disabled={!isAdmin || !!busy}
                    className="text-xs px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-300 flex items-center gap-1 disabled:opacity-40"
                >
                    <RefreshCw className={`w-3.5 h-3.5 ${busy === "refresh" ? "animate-spin" : ""}`} />
                    Comprobar
                </button>
            </div>

            <div className="p-6 space-y-6">
                {msg && <p className="text-xs text-sky-300 bg-sky-500/10 border border-sky-500/20 rounded-lg px-3 py-2">{msg}</p>}

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                    <div className="bg-black/30 rounded-xl p-3 border border-white/5">
                        <p className="text-[10px] uppercase text-slate-500 mb-1">Estado</p>
                        <p className="text-white font-medium">{agent?.installStatusLabel || "Sin datos"}</p>
                    </div>
                    <div className="bg-black/30 rounded-xl p-3 border border-white/5">
                        <p className="text-[10px] uppercase text-slate-500 mb-1">Versión</p>
                        <p className="text-white font-mono text-xs">{agent?.installedVersion || "—"} / {data?.officialVersion}</p>
                    </div>
                    <div className="bg-black/30 rounded-xl p-3 border border-white/5">
                        <p className="text-[10px] uppercase text-slate-500 mb-1">SHA-256</p>
                        <p className="text-slate-300 font-mono text-[10px] truncate" title={agent?.installedSha256 || ""}>
                            {agent?.installedSha256 ? `${agent.installedSha256.slice(0, 16)}…` : "—"}
                        </p>
                    </div>
                    <div className="bg-black/30 rounded-xl p-3 border border-white/5">
                        <p className="text-[10px] uppercase text-slate-500 mb-1">Alertas</p>
                        <p className="text-white font-semibold">{agent?.activeAlerts ?? 0}</p>
                    </div>
                </div>

                {agent?.lastError && (
                    <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{agent.lastError}</p>
                )}

                {isAdmin && (
                    <div className="flex flex-wrap gap-2">
                        {[
                            ["install", "Instalar"],
                            ["update", "Actualizar"],
                            ["reinstall", "Reinstalar"],
                            ["migrate", "Migrar legacy"],
                            ["diagnose", "Diagnóstico"],
                            ["test_telegram", "Probar Telegram"],
                        ].map(([id, label]) => (
                            <button
                                key={id}
                                onClick={() => action(id)}
                                disabled={!!busy || agent?.locked}
                                className="px-3 py-2 text-xs font-bold rounded-lg bg-slate-900/60 border border-slate-700 text-slate-200 hover:border-sky-500/40 disabled:opacity-40"
                            >
                                {busy === id ? "…" : label}
                            </button>
                        ))}
                    </div>
                )}

                {isAdmin && (
                    <div className="space-y-3">
                        <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Módulos</p>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                            {(["linux", "docker", "plesk", "s3"] as const).map((key) => (
                                <label key={key} className="flex items-center gap-2 text-xs text-slate-300 bg-white/[0.02] border border-white/5 rounded-lg px-3 py-2">
                                    <input
                                        type="checkbox"
                                        checked={Boolean(modules[key])}
                                        disabled={key === "linux"}
                                        onChange={(e) => setModules({ ...modules, [key]: e.target.checked })}
                                    />
                                    {key.toUpperCase()}
                                </label>
                            ))}
                        </div>
                        <button
                            onClick={saveModules}
                            disabled={!!busy}
                            className="px-4 py-2 text-xs font-bold rounded-lg bg-sky-500/20 border border-sky-500/30 text-sky-300"
                        >
                            Guardar módulos
                        </button>
                    </div>
                )}

                <div>
                    <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-3">Últimas operaciones</p>
                    <div className="space-y-2 max-h-56 overflow-y-auto">
                        {(agent?.operations || []).length === 0 && (
                            <p className="text-xs text-slate-600">Sin operaciones registradas.</p>
                        )}
                        {(agent?.operations || []).map((op: any) => (
                            <div key={op.id} className="flex items-center justify-between text-xs border border-white/5 rounded-lg px-3 py-2 bg-black/20">
                                <div>
                                    <span className="text-white font-medium">{op.type}</span>
                                    <span className="text-slate-500 ml-2">{op.progress}</span>
                                </div>
                                <span className={op.status === "SUCCESS" ? "text-emerald-400" : op.status === "ERROR" ? "text-red-400" : "text-amber-400"}>
                                    {op.status}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
