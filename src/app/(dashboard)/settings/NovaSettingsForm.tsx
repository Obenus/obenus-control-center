"use client";

import { useEffect, useState } from "react";
import { Radar } from "lucide-react";

export function NovaSettingsForm() {
    const [loading, setLoading] = useState(false);
    const [testLog, setTestLog] = useState<string | null>(null);
    const [form, setForm] = useState({
        botToken: "",
        chatId: "",
        alertsEnabled: true,
        dailyReportEnabled: true,
        reportHour: 9,
        thresholds: { memory: 90, disk: 90, dockerMemory: 85, sslDays: 15, backupMaxAgeHours: 36 },
        hasBotToken: false,
        hasChatId: false,
        botTokenMasked: "",
        chatIdMasked: "",
    });

    useEffect(() => {
        fetch("/api/nova/config")
            .then((r) => r.json())
            .then((cfg) => {
                setForm((prev) => ({
                    ...prev,
                    alertsEnabled: cfg.alertsEnabled,
                    dailyReportEnabled: cfg.dailyReportEnabled,
                    reportHour: cfg.reportHour,
                    thresholds: cfg.thresholds || prev.thresholds,
                    hasBotToken: cfg.hasBotToken,
                    hasChatId: cfg.hasChatId,
                    botTokenMasked: cfg.botTokenMasked || "",
                    chatIdMasked: cfg.chatIdMasked || "",
                }));
            })
            .catch(() => undefined);
    }, []);

    const save = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        await fetch("/api/nova/config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                botToken: form.botToken || undefined,
                chatId: form.chatId || undefined,
                alertsEnabled: form.alertsEnabled,
                dailyReportEnabled: form.dailyReportEnabled,
                reportHour: Number(form.reportHour),
                thresholds: form.thresholds,
            }),
        });
        setForm((f) => ({ ...f, botToken: "", chatId: "" }));
        const cfg = await fetch("/api/nova/config").then((r) => r.json());
        setForm((prev) => ({
            ...prev,
            hasBotToken: cfg.hasBotToken,
            hasChatId: cfg.hasChatId,
            botTokenMasked: cfg.botTokenMasked || "",
            chatIdMasked: cfg.chatIdMasked || "",
            alertsEnabled: cfg.alertsEnabled,
            dailyReportEnabled: cfg.dailyReportEnabled,
            reportHour: cfg.reportHour,
            thresholds: cfg.thresholds,
        }));
        setLoading(false);
    };

    const test = async () => {
        setTestLog("Conectando…");
        const res = await fetch("/api/nova/config/test-telegram", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                botToken: form.botToken || undefined,
                chatId: form.chatId || undefined,
            }),
        });
        const data = await res.json();
        setTestLog(data.success ? `✅ ${data.log}` : `❌ ${data.log}`);
    };

    return (
        <form id="nova" onSubmit={save} className="glass-card animated-border p-8 rounded-3xl relative overflow-hidden scroll-mt-28">
            <h2 className="text-xl font-bold text-white mb-2 relative z-10 flex items-center gap-2 font-display">
                <Radar className="w-5 h-5 text-sky-400" /> NOVA — Telegram y umbrales
            </h2>
            <p className="text-xs text-slate-500 mb-6">
                Único bot Telegram del sistema: alertas autónomas de los agentes NOVA y, si están activadas, avisos del Hub (tareas remotas).
                Credenciales cifradas; se distribuyen a los servidores por SSH seguro.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 relative z-10 mb-6">
                <div>
                    <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1 block">
                        Token bot {form.hasBotToken && <span className="text-emerald-500/80">(guardado: {form.botTokenMasked})</span>}
                    </label>
                    <input
                        type="password"
                        autoComplete="off"
                        value={form.botToken}
                        onChange={(e) => setForm({ ...form, botToken: e.target.value })}
                        placeholder={form.hasBotToken ? "Dejar vacío para conservar" : "123456:ABC…"}
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-slate-200 text-sm font-mono focus:border-sky-500 focus:outline-none"
                    />
                </div>
                <div>
                    <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1 block">
                        Chat ID {form.hasChatId && <span className="text-emerald-500/80">(guardado: {form.chatIdMasked})</span>}
                    </label>
                    <input
                        type="password"
                        autoComplete="off"
                        value={form.chatId}
                        onChange={(e) => setForm({ ...form, chatId: e.target.value })}
                        placeholder={form.hasChatId ? "Dejar vacío para conservar" : "-100…"}
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-slate-200 text-sm font-mono focus:border-sky-500 focus:outline-none"
                    />
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 relative z-10 mb-6">
                <label className="flex items-center gap-2 text-xs text-slate-300">
                    <input type="checkbox" checked={form.alertsEnabled} onChange={(e) => setForm({ ...form, alertsEnabled: e.target.checked })} />
                    Alertas activas
                </label>
                <label className="flex items-center gap-2 text-xs text-slate-300">
                    <input type="checkbox" checked={form.dailyReportEnabled} onChange={(e) => setForm({ ...form, dailyReportEnabled: e.target.checked })} />
                    Informe diario
                </label>
                <div>
                    <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1 block">Hora informe (0-23)</label>
                    <input
                        type="number"
                        min={0}
                        max={23}
                        value={form.reportHour}
                        onChange={(e) => setForm({ ...form, reportHour: Number(e.target.value) })}
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2 text-slate-200 text-sm font-mono"
                    />
                </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 relative z-10 mb-6">
                {(
                    [
                        ["memory", "RAM %"],
                        ["disk", "Disco %"],
                        ["dockerMemory", "Docker RAM %"],
                        ["sslDays", "SSL días"],
                        ["backupMaxAgeHours", "Backup h"],
                    ] as const
                ).map(([key, label]) => (
                    <div key={key}>
                        <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1 block">{label}</label>
                        <input
                            type="number"
                            value={(form.thresholds as any)[key]}
                            onChange={(e) =>
                                setForm({
                                    ...form,
                                    thresholds: { ...form.thresholds, [key]: Number(e.target.value) },
                                })
                            }
                            className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-slate-200 text-sm font-mono"
                        />
                    </div>
                ))}
            </div>

            {testLog && (
                <pre className="text-[10px] text-slate-300 font-mono whitespace-pre-wrap break-all mb-4 p-3 bg-black/50 border border-white/5 rounded-lg relative z-10">
                    {testLog}
                </pre>
            )}

            <div className="flex gap-4 relative z-10">
                <button type="button" onClick={test} className="w-1/3 py-3 rounded-xl bg-slate-800/50 border border-slate-700 hover:border-sky-500 text-slate-300 text-sm font-bold">
                    Probar Telegram
                </button>
                <button type="submit" disabled={loading} className="w-2/3 py-3 rounded-xl bg-sky-600/30 border border-sky-500/40 hover:bg-sky-500/30 text-white text-sm font-bold">
                    {loading ? "Guardando…" : "Guardar NOVA"}
                </button>
            </div>
        </form>
    );
}
