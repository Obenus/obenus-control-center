"use client";

import { useEffect, useState } from "react";
import { Eye, X } from "lucide-react";

export type TaskHistoryItem = {
    id: string;
    taskName: string;
    serverName: string;
    status: string;
    startedAt: string;
    finishedAt?: string | null;
    durationMs?: number | null;
    exitCode?: number | null;
    stdout?: string | null;
    stderr?: string | null;
};

function statusClass(status: string) {
    if (status === "SUCCESS") {
        return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 shadow-[0_0_8px_rgba(16,185,129,0.2)]";
    }
    if (status === "ERROR") {
        return "bg-red-500/10 text-red-400 border-red-500/20 shadow-[0_0_8px_rgba(239,68,68,0.2)]";
    }
    return "bg-amber-500/10 text-amber-400 border-amber-500/20";
}

export default function TaskHistoryTable({ tasks }: { tasks: TaskHistoryItem[] }) {
    const [selected, setSelected] = useState<TaskHistoryItem | null>(null);

    useEffect(() => {
        if (!selected) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setSelected(null);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [selected]);

    return (
        <>
            <div className="overflow-x-auto relative z-10">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="border-b border-white/10 text-[10px] uppercase tracking-widest text-slate-500">
                            <th className="pb-4 font-bold">Tarea</th>
                            <th className="pb-4 font-bold">Nodo</th>
                            <th className="pb-4 font-bold">Tiempo</th>
                            <th className="pb-4 font-bold text-right">Resultado</th>
                        </tr>
                    </thead>
                    <tbody className="text-sm">
                        {tasks.length === 0 && (
                            <tr>
                                <td colSpan={4} className="py-12 text-center text-slate-600 font-mono text-xs uppercase tracking-widest">
                                    Sin registros
                                </td>
                            </tr>
                        )}
                        {tasks.map((task) => (
                            <tr
                                key={task.id}
                                className="border-b border-white/5 hover:bg-white/[0.02] transition-colors cursor-pointer"
                                onClick={() => setSelected(task)}
                                title="Ver detalle"
                            >
                                <td className="py-4 pr-4 font-semibold text-white tracking-wide font-display text-[15px]">
                                    {task.taskName}
                                </td>
                                <td className="py-4 pr-4 text-slate-400">{task.serverName || "Eliminado"}</td>
                                <td className="py-4 pr-4 text-slate-500 font-mono text-[11px]">
                                    {new Date(task.startedAt).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })}
                                </td>
                                <td className="py-4 text-right">
                                    <span className="inline-flex items-center gap-2">
                                        <span
                                            className={`px-2.5 py-1 text-[10px] uppercase font-bold tracking-widest rounded border ${statusClass(task.status)}`}
                                        >
                                            {task.status}
                                        </span>
                                        <Eye className={`w-3.5 h-3.5 ${task.status === "ERROR" ? "text-red-400" : "text-slate-500"}`} />
                                    </span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {selected && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
                    onClick={() => setSelected(null)}
                >
                    <div
                        className="w-full max-w-2xl max-h-[85vh] overflow-hidden rounded-3xl border border-white/10 bg-[#0a0a10] shadow-2xl flex flex-col"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-start justify-between gap-4 p-6 border-b border-white/10">
                            <div>
                                <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1">Detalle de ejecución</p>
                                <h3 className="text-lg font-display font-semibold text-white">{selected.taskName}</h3>
                                <p className="text-xs text-slate-400 mt-1">
                                    {selected.serverName} ·{" "}
                                    {new Date(selected.startedAt).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setSelected(null)}
                                className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/5"
                                aria-label="Cerrar"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="p-6 space-y-4 overflow-y-auto">
                            <div className="flex flex-wrap gap-2 text-xs">
                                <span className={`px-2.5 py-1 rounded border font-bold tracking-widest uppercase ${statusClass(selected.status)}`}>
                                    {selected.status}
                                </span>
                                {selected.exitCode !== null && selected.exitCode !== undefined && (
                                    <span className="px-2.5 py-1 rounded border border-white/10 text-slate-300 font-mono">
                                        exit {selected.exitCode}
                                    </span>
                                )}
                                {selected.durationMs !== null && selected.durationMs !== undefined && (
                                    <span className="px-2.5 py-1 rounded border border-white/10 text-slate-300 font-mono">
                                        {selected.durationMs} ms
                                    </span>
                                )}
                            </div>

                            {selected.status === "ERROR" && (
                                <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-4">
                                    <p className="text-[10px] uppercase tracking-widest text-red-400 font-bold mb-2">Motivo del error</p>
                                    <pre className="text-xs text-red-100/90 font-mono whitespace-pre-wrap break-words">
                                        {(selected.stderr || selected.stdout || "Sin detalle registrado").trim()}
                                    </pre>
                                </div>
                            )}

                            {selected.stdout && selected.stdout.trim() && (
                                <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
                                    <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-2">Salida (stdout)</p>
                                    <pre className="text-xs text-slate-300 font-mono whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
                                        {selected.stdout.trim()}
                                    </pre>
                                </div>
                            )}

                            {selected.stderr && selected.stderr.trim() && selected.status !== "ERROR" && (
                                <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
                                    <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-2">Detalle adicional (stderr)</p>
                                    <pre className="text-xs text-slate-300 font-mono whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
                                        {selected.stderr.trim()}
                                    </pre>
                                </div>
                            )}

                            {selected.status === "ERROR" && selected.stderr && selected.stdout && selected.stdout.trim() && (
                                <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
                                    <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-2">Salida previa (stdout)</p>
                                    <pre className="text-xs text-slate-300 font-mono whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
                                        {selected.stdout.trim()}
                                    </pre>
                                </div>
                            )}

                            {!selected.stdout?.trim() && !selected.stderr?.trim() && selected.status !== "ERROR" && (
                                <p className="text-sm text-slate-500">No hay salida registrada para esta ejecución.</p>
                            )}
                        </div>

                        <div className="p-4 border-t border-white/10 flex justify-end">
                            <button
                                type="button"
                                onClick={() => setSelected(null)}
                                className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-slate-200 hover:border-sky-500/40"
                            >
                                Cerrar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
