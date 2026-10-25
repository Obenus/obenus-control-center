"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
    Activity,
    AlertTriangle,
    CheckCircle2,
    Download,
    FileUp,
    Loader2,
    Radar,
    RefreshCw,
    Server,
    ShieldAlert,
    Upload,
} from "lucide-react";

type NovaRow = {
    serverId: string;
    name: string;
    hostname: string;
    ip: string;
    os: string;
    installStatus: string;
    installStatusLabel: string;
    installedVersion: string | null;
    installedSha256: string | null;
    officialVersion: string;
    officialSha256: string;
    lastCheckedAt: string | null;
    monitoringStatus: string;
    activeAlerts: number;
    lastError: string | null;
    locked: boolean;
    legacyDetected?: string[] | null;
};

type Summary = {
    total: number;
    installed: number;
    pendingInstall: number;
    pendingUpdate: number;
    errors: number;
    activeAlerts: number;
    lastGlobalCheck: string | null;
    officialVersion: string;
    officialSha256: string;
    officialSource?: string;
    officialUpdatedAt?: string | null;
};

const STATUS_STYLE: Record<string, string> = {
    INSTALLED: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    UPDATE_AVAILABLE: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    NOT_INSTALLED: "bg-slate-500/10 text-slate-400 border-slate-500/20",
    INSTALLING: "bg-sky-500/10 text-sky-400 border-sky-500/20",
    UPDATING: "bg-sky-500/10 text-sky-400 border-sky-500/20",
    INSTALL_ERROR: "bg-red-500/10 text-red-400 border-red-500/20",
    CONNECTION_ERROR: "bg-red-500/10 text-red-400 border-red-500/20",
    UNKNOWN: "bg-slate-500/10 text-slate-500 border-slate-500/20",
};

export default function NovaPage() {
    const [rows, setRows] = useState<NovaRow[]>([]);
    const [summary, setSummary] = useState<Summary | null>(null);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState("all");
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [busy, setBusy] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [uploading, setUploading] = useState(false);
    const fileRef = useRef<HTMLInputElement | null>(null);

    const load = useCallback(async () => {
        const res = await fetch("/api/nova");
        if (!res.ok) {
            setMessage(res.status === 403 ? "Solo administradores pueden gestionar NOVA" : "Error al cargar NOVA");
            setLoading(false);
            return;
        }
        const data = await res.json();
        setRows(data.servers || []);
        setSummary(data.summary || null);
        setLoading(false);
    }, []);

    useEffect(() => {
        load();
        const t = setInterval(load, 8000);
        return () => clearInterval(t);
    }, [load]);

    const filtered = useMemo(() => {
        return rows.filter((r) => {
            if (filter === "all") return true;
            if (filter === "pending") return r.installStatus === "NOT_INSTALLED" || r.installStatus === "UNKNOWN";
            if (filter === "update") return r.installStatus === "UPDATE_AVAILABLE";
            if (filter === "errors") return r.installStatus === "INSTALL_ERROR" || r.installStatus === "CONNECTION_ERROR";
            if (filter === "ok") return r.installStatus === "INSTALLED";
            return true;
        });
    }, [rows, filter]);

    const toggle = (id: string) => {
        const next = new Set(selected);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelected(next);
    };

    const runAction = async (action: string, serverIds?: string[]) => {
        setBusy(action);
        setMessage(null);
        const res = await fetch("/api/nova/actions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                action,
                serverIds: serverIds || Array.from(selected),
                disableLegacy: action === "migrate",
            }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) setMessage(data.error || "No se pudo encolar la acción");
        else setMessage(`Acción «${action}» encolada correctamente`);
        setBusy(null);
        await load();
    };

    const uploadAgent = async (file: File | null) => {
        if (!file) return;
        setUploading(true);
        setMessage(null);
        const body = new FormData();
        body.append("file", file);
        body.append("refreshAfter", "true");
        const res = await fetch("/api/nova/agent", { method: "POST", body });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            setMessage(data.error || "No se pudo subir el agente");
        } else {
            setMessage(data.message || `Versión ${data.version} publicada`);
            if (data.changed) {
                // Opcional: ofrecer despliegue
            }
        }
        setUploading(false);
        if (fileRef.current) fileRef.current.value = "";
        await load();
    };

    if (loading) {
        return (
            <div className="flex justify-center items-center h-[50vh]">
                <Loader2 className="w-8 h-8 animate-spin text-sky-400" />
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto space-y-8 animate-in fade-in duration-500">
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-white mb-2 font-display flex items-center gap-3">
                        <Radar className="w-8 h-8 text-sky-400" />
                        NOVA — Monitorización de servidores
                    </h1>
                    <p className="text-slate-400">
                        Gestión centralizada del agente autónomo. Versión oficial{" "}
                        <span className="text-sky-400 font-mono">{summary?.officialVersion}</span>
                        {" · "}
                        <span className="font-mono text-xs text-slate-500">{summary?.officialSha256?.slice(0, 12)}…</span>
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <input
                        ref={fileRef}
                        type="file"
                        accept=".py,text/x-python,text/plain"
                        className="hidden"
                        onChange={(e) => uploadAgent(e.target.files?.[0] || null)}
                    />
                    <button
                        type="button"
                        onClick={() => fileRef.current?.click()}
                        disabled={uploading || !!busy}
                        className="px-4 py-2 rounded-xl bg-emerald-600/80 border border-emerald-400/30 text-sm text-white hover:bg-emerald-500 flex items-center gap-2 disabled:opacity-50"
                        title="Publicar un nuevo obenus-nova.py como versión oficial"
                    >
                        <FileUp className={`w-4 h-4 ${uploading ? "animate-pulse" : ""}`} />
                        {uploading ? "Subiendo…" : "Subir nueva versión"}
                    </button>
                    <button
                        onClick={() => runAction("refresh_all")}
                        disabled={!!busy}
                        className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-slate-200 hover:border-sky-500/40 flex items-center gap-2 disabled:opacity-50"
                    >
                        <RefreshCw className={`w-4 h-4 ${busy === "refresh_all" ? "animate-spin" : ""}`} />
                        Comprobar todos
                    </button>
                    <button
                        onClick={() => runAction("bulk_update")}
                        disabled={!!busy}
                        className="px-4 py-2 rounded-xl bg-indigo-600/80 border border-indigo-400/30 text-sm text-white hover:bg-indigo-500 flex items-center gap-2 disabled:opacity-50"
                    >
                        <Upload className="w-4 h-4" />
                        Actualización masiva
                    </button>
                    <Link
                        href="/settings#nova"
                        className="px-4 py-2 rounded-xl bg-slate-800 border border-slate-700 text-sm text-slate-200 hover:border-sky-500/40"
                    >
                        Configuración Telegram
                    </Link>
                </div>
            </div>

            <div className="glass-card rounded-2xl px-4 py-3 text-xs text-slate-400 border border-white/5 flex flex-wrap gap-x-4 gap-y-1">
                <span>
                    Oficial: <span className="text-sky-300 font-mono">{summary?.officialVersion}</span>
                </span>
                <span className="font-mono text-slate-500">{summary?.officialSha256?.slice(0, 16)}…</span>
                <span>
                    Origen:{" "}
                    <span className="text-slate-300">
                        {summary?.officialSource === "database" ? "subida en NOVA" : "archivo del sistema"}
                    </span>
                </span>
                {summary?.officialUpdatedAt && (
                    <span>
                        Actualizado:{" "}
                        {new Date(summary.officialUpdatedAt).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })}
                    </span>
                )}
            </div>

            {message && (
                <div className="glass-card rounded-2xl px-4 py-3 text-sm text-sky-200 border border-sky-500/20">
                    {message}
                </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3">
                {[
                    { label: "Total", value: summary?.total ?? 0, icon: Server, color: "text-blue-400" },
                    { label: "Instalados", value: summary?.installed ?? 0, icon: CheckCircle2, color: "text-emerald-400" },
                    { label: "Pend. instalar", value: summary?.pendingInstall ?? 0, icon: Download, color: "text-slate-300" },
                    { label: "Pend. actualizar", value: summary?.pendingUpdate ?? 0, icon: Upload, color: "text-amber-400" },
                    { label: "Errores", value: summary?.errors ?? 0, icon: ShieldAlert, color: "text-red-400" },
                    { label: "Alertas activas", value: summary?.activeAlerts ?? 0, icon: AlertTriangle, color: "text-orange-400" },
                    { label: "Última check", value: summary?.lastGlobalCheck ? new Date(summary.lastGlobalCheck).toLocaleString("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit" }) : "—", icon: Activity, color: "text-sky-400" },
                ].map((s) => (
                    <div key={s.label} className="glass-card animated-border rounded-2xl p-4">
                        <div className="flex items-center justify-between mb-2">
                            <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">{s.label}</p>
                            <s.icon className={`w-4 h-4 ${s.color}`} />
                        </div>
                        <p className="text-2xl font-display font-semibold text-white">{s.value}</p>
                    </div>
                ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
                {[
                    { id: "all", label: "Todos" },
                    { id: "ok", label: "Actualizados" },
                    { id: "pending", label: "Sin instalar" },
                    { id: "update", label: "Con actualización" },
                    { id: "errors", label: "Con errores" },
                ].map((f) => (
                    <button
                        key={f.id}
                        onClick={() => setFilter(f.id)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold tracking-wide border ${
                            filter === f.id
                                ? "bg-sky-500/20 text-sky-300 border-sky-500/40"
                                : "bg-white/[0.02] text-slate-400 border-white/10 hover:border-white/20"
                        }`}
                    >
                        {f.label}
                    </button>
                ))}
                {selected.size > 0 && (
                    <div className="ml-auto flex gap-2">
                        <button
                            onClick={() => runAction("install", Array.from(selected))}
                            disabled={!!busy}
                            className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                        >
                            Instalar ({selected.size})
                        </button>
                        <button
                            onClick={() => runAction("update", Array.from(selected))}
                            disabled={!!busy}
                            className="px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
                        >
                            Actualizar ({selected.size})
                        </button>
                        <button
                            onClick={() => runAction("refresh", Array.from(selected))}
                            disabled={!!busy}
                            className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-500/20 text-slate-300 border border-slate-500/30"
                        >
                            Comprobar
                        </button>
                    </div>
                )}
            </div>

            <div className="glass-card animated-border rounded-3xl overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse min-w-[1100px]">
                        <thead>
                            <tr className="border-b border-white/10 text-[10px] uppercase tracking-widest text-slate-500">
                                <th className="p-4 w-10"></th>
                                <th className="p-4 font-bold">Servidor</th>
                                <th className="p-4 font-bold">Hostname</th>
                                <th className="p-4 font-bold">IP</th>
                                <th className="p-4 font-bold">SO</th>
                                <th className="p-4 font-bold">Estado NOVA</th>
                                <th className="p-4 font-bold">Versión</th>
                                <th className="p-4 font-bold">SHA-256</th>
                                <th className="p-4 font-bold">Disponible</th>
                                <th className="p-4 font-bold">Última check</th>
                                <th className="p-4 font-bold">Monitor</th>
                                <th className="p-4 font-bold">Alertas</th>
                                <th className="p-4 font-bold text-right">Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="text-sm">
                            {filtered.length === 0 && (
                                <tr>
                                    <td colSpan={13} className="py-16 text-center text-slate-600 text-xs uppercase tracking-widest">
                                        Sin servidores en este filtro
                                    </td>
                                </tr>
                            )}
                            {filtered.map((r) => (
                                <tr key={r.serverId} className="border-b border-white/5 hover:bg-white/[0.02]">
                                    <td className="p-4">
                                        <input
                                            type="checkbox"
                                            checked={selected.has(r.serverId)}
                                            onChange={() => toggle(r.serverId)}
                                            className="rounded border-slate-600 bg-transparent"
                                        />
                                    </td>
                                    <td className="p-4">
                                        <Link href={`/servers/${r.serverId}`} className="font-semibold text-white hover:text-sky-300">
                                            {r.name}
                                        </Link>
                                        {r.locked && <span className="ml-2 text-[10px] text-amber-400">EN CURSO</span>}
                                    </td>
                                    <td className="p-4 text-slate-400 font-mono text-xs">{r.hostname}</td>
                                    <td className="p-4 text-slate-400 font-mono text-xs">{r.ip}</td>
                                    <td className="p-4 text-slate-400 uppercase text-xs">{r.os}</td>
                                    <td className="p-4">
                                        <span className={`px-2 py-1 text-[10px] uppercase font-bold tracking-widest rounded border ${STATUS_STYLE[r.installStatus] || STATUS_STYLE.UNKNOWN}`}>
                                            {r.monitoringStatus === "legacy" && r.installStatus === "NOT_INSTALLED"
                                                ? "Instalación antigua"
                                                : r.installStatusLabel}
                                        </span>
                                        {r.lastError && (
                                            <p className="text-[10px] text-amber-400/90 mt-1 max-w-[220px] truncate" title={r.lastError}>
                                                {r.lastError}
                                            </p>
                                        )}
                                    </td>
                                    <td className="p-4 font-mono text-xs text-slate-300">{r.installedVersion || "—"}</td>
                                    <td className="p-4 font-mono text-[10px] text-slate-500" title={r.installedSha256 || ""}>
                                        {r.installedSha256 ? `${r.installedSha256.slice(0, 10)}…` : "—"}
                                    </td>
                                    <td className="p-4 font-mono text-xs text-sky-300/80">{r.officialVersion}</td>
                                    <td className="p-4 text-slate-500 text-xs">
                                        {r.lastCheckedAt
                                            ? new Date(r.lastCheckedAt).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })
                                            : "—"}
                                    </td>
                                    <td className="p-4 text-xs uppercase tracking-wide text-slate-400">{r.monitoringStatus}</td>
                                    <td className="p-4 text-white font-semibold">{r.activeAlerts}</td>
                                    <td className="p-4">
                                        <div className="flex justify-end gap-1 flex-wrap">
                                            <button
                                                onClick={() => runAction("refresh", [r.serverId])}
                                                className="px-2 py-1 text-[10px] rounded bg-white/5 border border-white/10 text-slate-300 hover:border-sky-500/40"
                                            >
                                                Check
                                            </button>
                                            {r.installStatus === "NOT_INSTALLED" || r.installStatus === "UNKNOWN" ? (
                                                <button
                                                    onClick={() => runAction("install", [r.serverId])}
                                                    className="px-2 py-1 text-[10px] rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300"
                                                >
                                                    Instalar
                                                </button>
                                            ) : (
                                                <button
                                                    onClick={() => runAction("update", [r.serverId])}
                                                    className="px-2 py-1 text-[10px] rounded bg-indigo-500/15 border border-indigo-500/30 text-indigo-300"
                                                >
                                                    Actualizar
                                                </button>
                                            )}
                                            <button
                                                onClick={() => runAction("migrate", [r.serverId])}
                                                className="px-2 py-1 text-[10px] rounded bg-amber-500/10 border border-amber-500/20 text-amber-300"
                                                title="Migrar instalación antigua"
                                            >
                                                Migrar
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
