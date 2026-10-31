"use client";

import { useState } from "react";
import { KeyRound, Save, Shield } from "lucide-react";

type Props = {
    server: {
        id: string;
        name: string;
        hostname: string;
        ip: string;
        os: string;
        sshPort: number;
        sshUser: string;
        authMethod: string;
        status: string;
        sshHostFingerprint?: string | null;
        alertsMutedUntil?: string | null;
    };
    onSaved?: (server: any) => void;
    isAdmin?: boolean;
};

export default function ServerConnectionForm({ server, onSaved, isAdmin }: Props) {
    const [form, setForm] = useState({
        name: server.name || "",
        hostname: server.hostname || "",
        ip: server.ip || "",
        os: server.os || "ubuntu",
        sshPort: String(server.sshPort || 22),
        sshUser: server.sshUser || "root",
        authMethod: server.authMethod || "KEY",
        credential: "",
        status: server.status || "ACTIVE",
    });
    const [loading, setLoading] = useState(false);
    const [msg, setMsg] = useState<string | null>(null);
    const [err, setErr] = useState<string | null>(null);
    const [pendingFp, setPendingFp] = useState<string | null>(null);
    const [storedFp, setStoredFp] = useState<string | null>(server.sshHostFingerprint || null);
    const [hostBusy, setHostBusy] = useState(false);

    const save = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setMsg(null);
        setErr(null);

        const payload: Record<string, unknown> = {
            name: form.name,
            hostname: form.hostname,
            ip: form.ip,
            os: form.os,
            sshPort: form.sshPort,
            sshUser: form.sshUser,
            authMethod: form.authMethod,
            status: form.status,
        };
        if (form.credential.trim()) {
            payload.credential = form.credential;
        }

        const res = await fetch(`/api/servers/${server.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            setErr(data.error || "No se pudo guardar la conexión");
            setLoading(false);
            return;
        }

        setForm((f) => ({ ...f, credential: "" }));
        setMsg(
            payload.credential
                ? "Conexión y credenciales actualizadas"
                : "Conexión actualizada (credencial anterior conservada)"
        );
        onSaved?.(data);
        setLoading(false);
    };

    return (
        <form onSubmit={save} className="glassmorphism rounded-2xl border border-white/5 shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-white/5 bg-black/20 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                    <KeyRound className="w-5 h-5 text-amber-400" /> Conexión SSH
                </h2>
                <span className="text-[10px] uppercase tracking-widest text-emerald-400/80 flex items-center gap-1">
                    <Shield className="w-3 h-3" /> AES-256
                </span>
            </div>

            <div className="p-6 space-y-4">
                <p className="text-xs text-slate-500">
                    Actualiza IP, usuario o contraseña/clave si rotas credenciales en el servidor. Deja la credencial vacía para conservar la actual.
                </p>

                {(msg || err) && (
                    <div className={`text-xs rounded-lg px-3 py-2 border ${err ? "text-red-300 bg-red-500/10 border-red-500/20" : "text-emerald-300 bg-emerald-500/10 border-emerald-500/20"}`}>
                        {err || msg}
                    </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1 block">Nombre</label>
                        <input
                            required
                            value={form.name}
                            onChange={(e) => setForm({ ...form, name: e.target.value })}
                            className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-slate-200 focus:border-amber-500/50 outline-none"
                        />
                    </div>
                    <div>
                        <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1 block">Estado</label>
                        <select
                            value={form.status}
                            onChange={(e) => setForm({ ...form, status: e.target.value })}
                            className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-slate-200 outline-none"
                        >
                            <option value="ACTIVE">ACTIVE</option>
                            <option value="INACTIVE">INACTIVE</option>
                        </select>
                    </div>
                    <div>
                        <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1 block">IP / Host</label>
                        <input
                            required
                            value={form.ip}
                            onChange={(e) => setForm({ ...form, ip: e.target.value })}
                            className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-slate-200 font-mono outline-none"
                        />
                    </div>
                    <div>
                        <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1 block">Hostname</label>
                        <input
                            value={form.hostname}
                            onChange={(e) => setForm({ ...form, hostname: e.target.value })}
                            className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-slate-200 font-mono outline-none"
                        />
                    </div>
                    <div>
                        <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1 block">Puerto SSH</label>
                        <input
                            required
                            type="number"
                            min={1}
                            max={65535}
                            value={form.sshPort}
                            onChange={(e) => setForm({ ...form, sshPort: e.target.value })}
                            className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-slate-200 font-mono outline-none"
                        />
                    </div>
                    <div>
                        <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1 block">Usuario SSH</label>
                        <input
                            required
                            value={form.sshUser}
                            onChange={(e) => setForm({ ...form, sshUser: e.target.value })}
                            className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-slate-200 font-mono outline-none"
                        />
                    </div>
                    <div>
                        <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1 block">SO</label>
                        <select
                            value={form.os}
                            onChange={(e) => setForm({ ...form, os: e.target.value })}
                            className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-slate-200 outline-none"
                        >
                            <option value="ubuntu">Ubuntu</option>
                            <option value="debian">Debian</option>
                            <option value="almalinux">AlmaLinux</option>
                            <option value="centos">CentOS</option>
                            <option value="rocky">Rocky</option>
                            <option value="rhel">RHEL</option>
                        </select>
                    </div>
                    <div>
                        <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1 block">Método</label>
                        <select
                            value={form.authMethod}
                            onChange={(e) => setForm({ ...form, authMethod: e.target.value })}
                            className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-slate-200 outline-none"
                        >
                            <option value="KEY">Clave SSH</option>
                            <option value="PASSWORD">Contraseña</option>
                        </select>
                    </div>
                </div>

                <div>
                    <label className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-1 block">
                        {form.authMethod === "KEY" ? "Nueva clave privada (opcional)" : "Nueva contraseña (opcional)"}
                    </label>
                    {form.authMethod === "KEY" ? (
                        <textarea
                            rows={4}
                            value={form.credential}
                            onChange={(e) => setForm({ ...form, credential: e.target.value })}
                            placeholder="Dejar vacío para no cambiar la clave almacenada"
                            className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-slate-200 font-mono outline-none"
                            autoComplete="off"
                        />
                    ) : (
                        <input
                            type="password"
                            value={form.credential}
                            onChange={(e) => setForm({ ...form, credential: e.target.value })}
                            placeholder="Dejar vacío para no cambiar la contraseña"
                            className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-slate-200 font-mono outline-none"
                            autoComplete="new-password"
                        />
                    )}
                </div>

                <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-3 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-200 text-sm font-bold hover:bg-amber-500/25 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                    <Save className="w-4 h-4" />
                    {loading ? "Guardando…" : "Guardar conexión"}
                </button>

                {isAdmin && (
                    <div className="pt-4 border-t border-white/5 space-y-3">
                        <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">
                            Clave de host SSH (anti-MITM)
                        </p>
                        <p className="text-xs text-slate-500">
                            Guardada:{" "}
                            <span className="font-mono text-slate-300">
                                {storedFp || "ninguna — hay que confirmar"}
                            </span>
                        </p>
                        {pendingFp && (
                            <p className="text-xs text-amber-300 font-mono break-all">
                                Detectada: {pendingFp}
                            </p>
                        )}
                        <div className="flex flex-wrap gap-2">
                            <button
                                type="button"
                                disabled={hostBusy}
                                onClick={async () => {
                                    setHostBusy(true);
                                    setErr(null);
                                    const res = await fetch(`/api/servers/${server.id}/host-key`);
                                    const d = await res.json().catch(() => ({}));
                                    setHostBusy(false);
                                    if (!res.ok) {
                                        setErr(d.error || "No se pudo leer la clave");
                                        return;
                                    }
                                    setPendingFp(d.fingerprint);
                                    setStoredFp(d.stored);
                                    setMsg(
                                        d.confirmed
                                            ? "Fingerprint coincide con el almacenado"
                                            : "Confirma el fingerprint si corresponde a este servidor"
                                    );
                                }}
                                className="px-3 py-1.5 rounded-lg text-xs border border-white/10 text-slate-300"
                            >
                                Comprobar fingerprint
                            </button>
                            {pendingFp && (
                                <button
                                    type="button"
                                    disabled={hostBusy}
                                    onClick={async () => {
                                        if (
                                            !confirm(
                                                `¿Confirmar fingerprint?\n${pendingFp}\n\nSolo acepta si verifica el host.`
                                            )
                                        )
                                            return;
                                        setHostBusy(true);
                                        const res = await fetch(`/api/servers/${server.id}/host-key`, {
                                            method: "POST",
                                            headers: { "Content-Type": "application/json" },
                                            body: JSON.stringify({ fingerprint: pendingFp }),
                                        });
                                        const d = await res.json().catch(() => ({}));
                                        setHostBusy(false);
                                        if (!res.ok) {
                                            setErr(d.error || "No se pudo confirmar");
                                            return;
                                        }
                                        setStoredFp(d.fingerprint);
                                        setPendingFp(null);
                                        setMsg("Fingerprint confirmado");
                                    }}
                                    className="px-3 py-1.5 rounded-lg text-xs bg-emerald-600/80 text-white"
                                >
                                    Confirmar fingerprint
                                </button>
                            )}
                            {storedFp && (
                                <button
                                    type="button"
                                    disabled={hostBusy}
                                    onClick={async () => {
                                        if (!confirm("¿Borrar fingerprint? Se pedirá confirmación de nuevo."))
                                            return;
                                        setHostBusy(true);
                                        await fetch(`/api/servers/${server.id}/host-key`, {
                                            method: "DELETE",
                                        });
                                        setHostBusy(false);
                                        setStoredFp(null);
                                        setMsg("Fingerprint borrado");
                                    }}
                                    className="px-3 py-1.5 rounded-lg text-xs border border-red-500/30 text-red-300"
                                >
                                    Olvidar
                                </button>
                            )}
                        </div>
                        <div className="flex flex-wrap gap-2 pt-2">
                            <button
                                type="button"
                                onClick={async () => {
                                    await fetch(`/api/servers/${server.id}/mute`, {
                                        method: "POST",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({ hours: 2 }),
                                    });
                                    setMsg("Alertas silenciadas 2h en este servidor");
                                }}
                                className="px-3 py-1.5 rounded-lg text-xs border border-amber-500/30 text-amber-300"
                            >
                                Mute alertas 2h
                            </button>
                            <button
                                type="button"
                                onClick={async () => {
                                    await fetch(`/api/servers/${server.id}/mute`, {
                                        method: "POST",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({ hours: 0 }),
                                    });
                                    setMsg("Mute cancelado");
                                }}
                                className="px-3 py-1.5 rounded-lg text-xs border border-white/10 text-slate-400"
                            >
                                Quitar mute
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </form>
    );
}
