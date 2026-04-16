"use client";

import { useState } from "react";
import { Mail, Bell } from "lucide-react";
import { useRouter } from "next/navigation";

export function SettingsForms({ initialSmtp, initialTelegram }: any) {
    const router = useRouter();

    const [smtp, setSmtp] = useState<{ host: string; user: string; pass: string; port: string; recipients: string; filters: string[] }>({
        host: initialSmtp.host || "",
        user: initialSmtp.user || "",
        pass: initialSmtp.pass || "",
        port: initialSmtp.port || "587",
        recipients: initialSmtp.recipients || "",
        filters: initialSmtp.filters || ["ERROR", "CRITICAL"]
    });

    const [telegram, setTelegram] = useState({
        token: initialTelegram.token || "",
        chatId: initialTelegram.chatId || ""
    });

    const [loading1, setLoading1] = useState(false);
    const [loading2, setLoading2] = useState(false);
    const [testLogSmtp, setTestLogSmtp] = useState<string | null>(null);
    const [testLogTelegram, setTestLogTelegram] = useState<string | null>(null);

    const testSmtp = async () => {
        setTestLogSmtp("Conectando...");
        try {
            const res = await fetch("/api/settings/test-smtp", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ host: smtp.host, user: smtp.user, pass: smtp.pass, port: smtp.port, recipients: smtp.recipients })
            });
            const data = await res.json();
            setTestLogSmtp(data.success ? `✅ Éxito:\n${data.log}` : `❌ Fallo:\n${data.log}`);
        } catch (e: any) { setTestLogSmtp(`❌ Error interno: ${e.message}`); }
    };

    const testTelegram = async () => {
        setTestLogTelegram("Conectando...");
        try {
            const res = await fetch("/api/settings/test-telegram", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token: telegram.token, chatId: telegram.chatId })
            });
            const data = await res.json();
            setTestLogTelegram(data.success ? `✅ Éxito:\n${data.log}` : `❌ Fallo:\n${data.log}`);
        } catch (e: any) { setTestLogTelegram(`❌ Error interno: ${e.message}`); }
    };

    const saveSmtp = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading1(true);
        await fetch("/api/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ smtpHost: smtp.host, smtpUser: smtp.user, smtpPass: smtp.pass, smtpPort: smtp.port, smtpRecipients: smtp.recipients, smtpFilters: smtp.filters })
        });
        setLoading1(false);
        router.refresh();
    };

    const saveTelegram = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading2(true);
        await fetch("/api/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ telegramToken: telegram.token, telegramChatId: telegram.chatId })
        });
        setLoading2(false);
        router.refresh();
    };

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <form onSubmit={saveSmtp} className="glass-card animated-border p-8 rounded-3xl relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform duration-700">
                    <Mail className="w-48 h-48 text-sky-500 -mr-10 -mt-10" />
                </div>
                <h2 className="text-xl font-bold text-white mb-4 relative z-10 flex items-center gap-2 font-display">
                    <Mail className="w-5 h-5 text-sky-400" /> Servidor SMTP
                </h2>
                <div className="space-y-4 relative z-10 mb-8">
                    <div>
                        <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1 block">SMTP Host</label>
                        <input required value={smtp.host} onChange={(e) => setSmtp({ ...smtp, host: e.target.value })} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-slate-200 text-sm font-mono focus:border-sky-500 focus:outline-none" />
                    </div>
                    <div>
                        <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1 block">SMTP Port</label>
                        <input required value={smtp.port} onChange={(e) => setSmtp({ ...smtp, port: e.target.value })} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-slate-200 text-sm font-mono focus:border-sky-500 focus:outline-none" />
                    </div>
                    <div>
                        <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1 block">SMTP Email / Usuario</label>
                        <input required value={smtp.user} onChange={(e) => setSmtp({ ...smtp, user: e.target.value })} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-slate-200 text-sm font-mono focus:border-sky-500 focus:outline-none" />
                    </div>
                    <div>
                        <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1 block">Contraseña de Aplicación</label>
                        <input type="password" required value={smtp.pass} onChange={(e) => setSmtp({ ...smtp, pass: e.target.value })} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-slate-200 text-sm font-mono focus:border-sky-500 focus:outline-none" />
                    </div>
                    <div>
                        <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1 block">Correos Destinatarios (Separados por coma)</label>
                        <input type="text" value={smtp.recipients} onChange={(e) => setSmtp({ ...smtp, recipients: e.target.value })} placeholder="admin@ejemplo.com, dev@ejemplo.com" className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-slate-200 text-sm font-mono focus:border-sky-500 focus:outline-none" />
                    </div>
                    <div className="pt-2">
                        <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-3 block border-t border-white/10 pt-4">¿Cuándo enviar un Email a estos Destinatarios?</label>
                        <div className="space-y-2">
                            <label className="flex items-center gap-3">
                                <input type="checkbox" checked={!smtp.filters || smtp.filters.includes("ERROR")} onChange={(e) => {
                                    const next = new Set(smtp.filters || ["ERROR", "CRITICAL"]);
                                    if (e.target.checked) { next.add("ERROR"); next.add("CRITICAL"); } else { next.delete("ERROR"); next.delete("CRITICAL"); }
                                    setSmtp({ ...smtp, filters: Array.from(next) });
                                }} className="rounded border-slate-700 bg-slate-800 text-sky-500 shadow-sm focus:ring-sky-500 focus:ring-2 bg-transparent w-4 h-4" />
                                <span className="text-xs text-slate-300">Si ocurren Fallos Críticos o Errores de Conexión en las Tareas.</span>
                            </label>
                            <label className="flex items-center gap-3">
                                <input type="checkbox" checked={smtp.filters && smtp.filters.includes("SUCCESS")} onChange={(e) => {
                                    const next = new Set(smtp.filters || ["ERROR", "CRITICAL"]);
                                    if (e.target.checked) next.add("SUCCESS"); else next.delete("SUCCESS");
                                    setSmtp({ ...smtp, filters: Array.from(next) });
                                }} className="rounded border-slate-700 bg-slate-800 text-sky-500 shadow-sm focus:ring-sky-500 focus:ring-2 bg-transparent w-4 h-4" />
                                <span className="text-xs text-slate-300">Todas las veces. Incluso cuando las Tareas de Limpieza son Exitosas.</span>
                            </label>
                            <label className="flex items-center gap-3">
                                <input type="checkbox" checked={smtp.filters && smtp.filters.includes("AUDIT")} onChange={(e) => {
                                    const next = new Set(smtp.filters || ["ERROR", "CRITICAL"]);
                                    if (e.target.checked) next.add("AUDIT"); else next.delete("AUDIT");
                                    setSmtp({ ...smtp, filters: Array.from(next) });
                                }} className="rounded border-slate-700 bg-slate-800 text-sky-500 shadow-sm focus:ring-sky-500 focus:ring-2 bg-transparent w-4 h-4" />
                                <span className="text-xs text-slate-300">Sucesos de Auditoría (Ej. Se añade un Nuevo Nodo)</span>
                            </label>
                        </div>
                    </div>
                    {testLogSmtp && (
                        <div className="p-3 bg-black/50 border border-white/5 rounded-lg">
                            <pre className="text-[10px] text-slate-300 font-mono whitespace-pre-wrap break-all">{testLogSmtp}</pre>
                        </div>
                    )}
                </div>
                <div className="flex gap-4 relative z-10">
                    <button type="button" onClick={testSmtp} className="w-1/3 py-3 rounded-xl bg-slate-800/50 border border-slate-700 hover:border-sky-500 hover:text-sky-400 text-slate-400 text-sm font-bold tracking-wide transition-colors">
                        Probar
                    </button>
                    <button type="submit" disabled={loading1} className="w-2/3 py-3 rounded-xl bg-slate-800 border border-slate-700 hover:border-sky-500 hover:bg-sky-500/20 text-white text-sm font-bold tracking-wide transition-colors">
                        {loading1 ? "Guardando..." : "Guardar SMTP"}
                    </button>
                </div>
            </form>

            <form onSubmit={saveTelegram} className="glass-card animated-border p-8 rounded-3xl relative overflow-hidden group h-fit">
                <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform duration-700">
                    <Bell className="w-48 h-48 text-indigo-500 -mr-10 -mt-10" />
                </div>
                <h2 className="text-xl font-bold text-white mb-4 relative z-10 flex items-center gap-2 font-display">
                    <Bell className="w-5 h-5 text-indigo-400" /> Telegram Bot API
                </h2>
                <div className="space-y-4 relative z-10 mb-8">
                    <div>
                        <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1 block">Bot Token Completo</label>
                        <input type="text" required value={telegram.token} onChange={(e) => setTelegram({ ...telegram, token: e.target.value })} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-slate-200 text-sm font-mono focus:border-indigo-500 focus:outline-none" placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11" />
                    </div>
                    <div>
                        <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1 block">Chat ID Objetivo</label>
                        <input type="text" required value={telegram.chatId} onChange={(e) => setTelegram({ ...telegram, chatId: e.target.value })} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-slate-200 text-sm font-mono focus:border-indigo-500 focus:outline-none" placeholder="-100987654321" />
                    </div>
                    {testLogTelegram && (
                        <div className="p-3 bg-black/50 border border-white/5 rounded-lg mt-2">
                            <pre className="text-[10px] text-slate-300 font-mono whitespace-pre-wrap break-all">{testLogTelegram}</pre>
                        </div>
                    )}
                </div>
                <div className="flex gap-4 relative z-10 mt-auto">
                    <button type="button" onClick={testTelegram} className="w-1/3 py-3 rounded-xl bg-slate-800/50 border border-slate-700 hover:border-indigo-500 hover:text-indigo-400 text-slate-400 text-sm font-bold tracking-wide transition-colors">
                        Probar
                    </button>
                    <button type="submit" disabled={loading2} className="w-2/3 py-3 rounded-xl bg-slate-800 border border-slate-700 hover:border-indigo-500 hover:bg-indigo-500/20 text-white text-sm font-bold tracking-wide transition-colors">
                        {loading2 ? "Guardando..." : "Guardar Telegram"}
                    </button>
                </div>
            </form>
        </div>
    );
}
