"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CalendarClock, Loader2, Trash2 } from "lucide-react";

type Row = {
    serverId: string | null;
    serverName: string;
    taskName: string;
    cron: string;
    key: string;
    next?: number | null;
    ghost?: boolean;
    orphan?: boolean;
};

export default function SchedulesInventoryPage() {
    const [rows, setRows] = useState<Row[]>([]);
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState<string | null>(null);

    const load = useCallback(async () => {
        const res = await fetch("/api/admin/schedules");
        if (!res.ok) {
            setMessage("No se pudo cargar el inventario (¿admin?)");
            setLoading(false);
            return;
        }
        const data = await res.json();
        setRows(data.schedules || []);
        setLoading(false);
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const remove = async (row: Row) => {
        if (!row.serverId || !row.key) return;
        if (!confirm(`Eliminar «${row.taskName}» en ${row.serverName}?`)) return;
        const res = await fetch(`/api/servers/${row.serverId}/tasks/schedule`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key: row.key }),
        });
        if (!res.ok) setMessage("No se pudo eliminar");
        else setMessage("Eliminada");
        await load();
    };

    if (loading) {
        return (
            <div className="flex justify-center items-center h-[40vh]">
                <Loader2 className="w-8 h-8 animate-spin text-sky-400" />
            </div>
        );
    }

    return (
        <div className="max-w-5xl mx-auto space-y-6 animate-in fade-in duration-500">
            <div>
                <h1 className="text-3xl font-bold text-white font-display flex items-center gap-3">
                    <CalendarClock className="w-8 h-8 text-sky-400" />
                    Inventario de rutinas
                </h1>
                <p className="text-slate-400 text-sm mt-1">
                    Todas las programaciones AppConfig + jobs Redis (fantasmas incluidos).
                </p>
            </div>

            {message && (
                <div className="glass-card rounded-xl px-4 py-3 text-sm text-sky-200 border border-sky-500/20">
                    {message}
                </div>
            )}

            <div className="glass-card animated-border rounded-2xl overflow-hidden">
                <table className="w-full text-left text-sm">
                    <thead>
                        <tr className="border-b border-white/10 text-[10px] uppercase tracking-wider text-slate-500">
                            <th className="px-4 py-3">Servidor</th>
                            <th className="px-4 py-3">Tarea</th>
                            <th className="px-4 py-3">Cron</th>
                            <th className="px-4 py-3">Próximo</th>
                            <th className="px-4 py-3">Estado</th>
                            <th className="px-4 py-3 text-right"> </th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.length === 0 && (
                            <tr>
                                <td colSpan={6} className="px-4 py-12 text-center text-slate-600 text-xs">
                                    Sin rutinas
                                </td>
                            </tr>
                        )}
                        {rows.map((r) => (
                            <tr key={`${r.serverId}-${r.key}`} className="border-b border-white/5">
                                <td className="px-4 py-3">
                                    {r.serverId ? (
                                        <Link
                                            href={`/servers/${r.serverId}`}
                                            className="text-white hover:text-sky-300 font-medium"
                                        >
                                            {r.serverName}
                                        </Link>
                                    ) : (
                                        <span className="text-amber-300">{r.serverName}</span>
                                    )}
                                </td>
                                <td className="px-4 py-3 text-slate-300">{r.taskName}</td>
                                <td className="px-4 py-3 font-mono text-xs text-slate-500">{r.cron}</td>
                                <td className="px-4 py-3 text-xs text-slate-500">
                                    {r.next
                                        ? new Date(r.next).toLocaleString("es-ES", {
                                              timeZone: "Europe/Madrid",
                                          })
                                        : "—"}
                                </td>
                                <td className="px-4 py-3 text-[10px] uppercase font-bold tracking-wide">
                                    {r.ghost ? (
                                        <span className="text-amber-400">Fantasma</span>
                                    ) : r.orphan ? (
                                        <span className="text-amber-400">Huérfana</span>
                                    ) : (
                                        <span className="text-emerald-400">OK</span>
                                    )}
                                </td>
                                <td className="px-4 py-3 text-right">
                                    {r.serverId && (
                                        <button
                                            type="button"
                                            onClick={() => remove(r)}
                                            className="p-1.5 rounded border border-red-500/20 text-red-400 hover:bg-red-500/10"
                                            title="Eliminar"
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
