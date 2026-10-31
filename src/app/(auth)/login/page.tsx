"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "lucide-react";

export default function LoginPage() {
    const router = useRouter();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [totp, setTotp] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        const res = await signIn("credentials", {
            email,
            password,
            totp: totp || undefined,
            redirect: false,
        });

        if (res?.error) {
            setError(
                totp
                    ? "Credenciales o código 2FA incorrectos"
                    : "Acceso denegado. Si tienes 2FA, introduce el código."
            );
            setLoading(false);
        } else {
            router.push("/dashboard");
        }
    };

    return (
        <main className="min-h-screen w-full flex items-center justify-center relative overflow-hidden">
            <div className="absolute top-[10%] left-[20%] w-[500px] h-[500px] bg-sky-500/10 rounded-full blur-[120px] pointer-events-none mix-blend-screen" />
            <div className="absolute bottom-[10%] right-[20%] w-[600px] h-[600px] bg-violet-600/10 rounded-full blur-[150px] pointer-events-none mix-blend-screen" />

            <div className="w-full max-w-[420px] z-10 p-6 animate-in slide-in-from-bottom-8 fade-in duration-700">
                <div className="glass-card animated-border rounded-[2rem] p-10 flex flex-col items-center">
                    <div className="relative mb-6 group">
                        <div className="absolute inset-0 bg-gradient-to-tr from-sky-400 to-indigo-500 rounded-2xl blur-lg opacity-40 group-hover:opacity-60 transition-opacity duration-500"></div>
                        <div className="relative w-16 h-16 bg-gradient-to-tr from-[#0f172a] to-[#1e293b] border border-white/10 rounded-2xl shadow-xl flex items-center justify-center">
                            <Command className="w-8 h-8 text-sky-400 group-hover:scale-110 transition-transform duration-500" />
                        </div>
                    </div>

                    <h1 className="font-display text-3xl font-semibold text-transparent bg-clip-text bg-gradient-to-br from-white to-white/60 tracking-tight mb-2">
                        Obenus Control
                    </h1>
                    <p className="text-sm font-medium text-slate-400/80 mb-8 text-center px-4 leading-relaxed tracking-wide">
                        Infraestructura centralizada de alto rendimiento.
                    </p>

                    <form onSubmit={handleSubmit} className="w-full space-y-5">
                        {error && (
                            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center gap-3 animate-in fade-in zoom-in-95">
                                <span className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]"></span>
                                <p className="text-red-400 text-xs font-medium tracking-wide">{error}</p>
                            </div>
                        )}

                        <div className="space-y-2 group/input">
                            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1 transition-colors group-focus-within/input:text-sky-400">
                                Identidad
                            </label>
                            <input
                                type="email"
                                required
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="w-full px-5 py-3.5 bg-black/20 border border-white/5 rounded-xl focus:outline-none focus:bg-black/40 focus:border-sky-500/50 focus:ring-1 focus:ring-sky-500/50 transition-all text-white placeholder-slate-700/50 text-sm font-medium shadow-inner shadow-black/50"
                                placeholder="admin@obenus.local"
                            />
                        </div>

                        <div className="space-y-2 group/input">
                            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1 transition-colors group-focus-within/input:text-sky-400">
                                Código de Acceso
                            </label>
                            <input
                                type="password"
                                required
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full px-5 py-3.5 bg-black/20 border border-white/5 rounded-xl focus:outline-none focus:bg-black/40 focus:border-sky-500/50 focus:ring-1 focus:ring-sky-500/50 transition-all text-white placeholder-slate-700/50 text-sm font-medium shadow-inner shadow-black/50"
                                placeholder="••••••••••"
                            />
                        </div>

                        <div className="space-y-2 group/input">
                            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1 transition-colors group-focus-within/input:text-sky-400">
                                Código 2FA (si está activo)
                            </label>
                            <input
                                type="text"
                                inputMode="numeric"
                                autoComplete="one-time-code"
                                value={totp}
                                onChange={(e) => setTotp(e.target.value)}
                                className="w-full px-5 py-3.5 bg-black/20 border border-white/5 rounded-xl focus:outline-none focus:bg-black/40 focus:border-sky-500/50 focus:ring-1 focus:ring-sky-500/50 transition-all text-white placeholder-slate-700/50 text-sm font-medium tracking-widest text-center"
                                placeholder="000000"
                                maxLength={6}
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="relative w-full mt-8 px-4 py-4 rounded-xl overflow-hidden font-medium text-sm transition-all focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 focus:ring-offset-[#050508] disabled:opacity-50 disabled:cursor-not-allowed group"
                        >
                            <div className="absolute inset-0 bg-gradient-to-r from-sky-500 to-indigo-600 transition-transform duration-700 group-hover:scale-[1.05]" />
                            <span className="relative z-10 flex items-center justify-center text-white tracking-wide font-display font-semibold">
                                {loading ? "Verificando…" : "Acceder al Sistema"}
                            </span>
                        </button>
                    </form>
                </div>
            </div>
        </main>
    );
}
