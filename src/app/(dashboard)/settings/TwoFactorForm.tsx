"use client";

import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";

export function TwoFactorForm() {
    const [enabled, setEnabled] = useState(false);
    const [secret, setSecret] = useState<string | null>(null);
    const [otpauthUrl, setOtpauthUrl] = useState<string | null>(null);
    const [code, setCode] = useState("");
    const [password, setPassword] = useState("");
    const [msg, setMsg] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const refresh = async () => {
        const res = await fetch("/api/account/2fa");
        if (res.ok) {
            const d = await res.json();
            setEnabled(Boolean(d.enabled));
        }
    };

    useEffect(() => {
        refresh();
    }, []);

    const setup = async () => {
        setBusy(true);
        setMsg(null);
        const res = await fetch("/api/account/2fa", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "setup" }),
        });
        const d = await res.json().catch(() => ({}));
        setBusy(false);
        if (!res.ok) {
            setMsg(d.error || "Error");
            return;
        }
        setSecret(d.secret);
        setOtpauthUrl(d.otpauthUrl);
        setMsg("Escanea el secreto en tu app (Google Authenticator / Aegis) y confirma con un código.");
    };

    const enable = async () => {
        setBusy(true);
        const res = await fetch("/api/account/2fa", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "enable", code }),
        });
        const d = await res.json().catch(() => ({}));
        setBusy(false);
        if (!res.ok) {
            setMsg(d.error || "Código inválido");
            return;
        }
        setSecret(null);
        setOtpauthUrl(null);
        setCode("");
        setMsg("2FA activado");
        await refresh();
    };

    const disable = async () => {
        setBusy(true);
        const res = await fetch("/api/account/2fa", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "disable", code, password }),
        });
        const d = await res.json().catch(() => ({}));
        setBusy(false);
        if (!res.ok) {
            setMsg(d.error || "No se pudo desactivar");
            return;
        }
        setMsg("2FA desactivado");
        setCode("");
        setPassword("");
        await refresh();
    };

    return (
        <div className="glass-card animated-border rounded-2xl p-6 space-y-4">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-400" />
                Autenticación en dos pasos (TOTP)
            </h2>
            <p className="text-sm text-slate-400">
                Estado:{" "}
                <span className={enabled ? "text-emerald-400" : "text-amber-400"}>
                    {enabled ? "Activo" : "Inactivo"}
                </span>
            </p>
            {msg && <p className="text-xs text-sky-300">{msg}</p>}
            {secret && (
                <div className="bg-black/30 rounded-xl p-4 space-y-2 border border-white/5">
                    <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Secreto</p>
                    <p className="font-mono text-sm text-sky-300 break-all">{secret}</p>
                    {otpauthUrl && (
                        <p className="text-[10px] text-slate-500 break-all font-mono">{otpauthUrl}</p>
                    )}
                    <input
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        placeholder="Código de 6 dígitos"
                        className="w-full mt-2 px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-white text-sm"
                        maxLength={6}
                    />
                    <button
                        type="button"
                        disabled={busy}
                        onClick={enable}
                        className="px-4 py-2 rounded-lg bg-emerald-600/80 text-white text-sm"
                    >
                        Confirmar y activar
                    </button>
                </div>
            )}
            <div className="flex flex-wrap gap-2">
                {!enabled && !secret && (
                    <button
                        type="button"
                        disabled={busy}
                        onClick={setup}
                        className="px-4 py-2 rounded-lg bg-sky-600/80 text-white text-sm"
                    >
                        Configurar 2FA
                    </button>
                )}
                {enabled && (
                    <div className="flex flex-wrap gap-2 items-end w-full">
                        <input
                            value={code}
                            onChange={(e) => setCode(e.target.value)}
                            placeholder="Código 2FA"
                            className="px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-white text-sm"
                            maxLength={6}
                        />
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Tu contraseña"
                            className="px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-white text-sm"
                        />
                        <button
                            type="button"
                            disabled={busy}
                            onClick={disable}
                            className="px-4 py-2 rounded-lg bg-red-600/70 text-white text-sm"
                        >
                            Desactivar 2FA
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
