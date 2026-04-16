"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Save, Shield } from "lucide-react";
import Link from "next/link";

export default function NewServerPage() {
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const [formData, setFormData] = useState({
        name: "", hostname: "", ip: "", os: "ubuntu",
        sshPort: "22", sshUser: "root", authMethod: "KEY", credential: ""
    });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);

        const res = await fetch("/api/servers", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(formData),
        });

        if (res.ok) {
            router.push("/servers");
        } else {
            alert("Error al crear el servidor");
            setLoading(false);
        }
    };

    return (
        <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-500">
            <div className="flex items-center gap-4">
                <Link href="/servers" className="p-2 bg-slate-900 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors">
                    <ArrowLeft className="w-5 h-5" />
                </Link>
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-white mb-1">Añadir Servidor</h1>
                    <p className="text-slate-400 text-sm">Registra un nuevo nodo para administrar de forma remota.</p>
                </div>
            </div>

            <form onSubmit={handleSubmit} className="glassmorphism rounded-2xl p-8 border border-white/5 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Nombre Identificativo</label>
                        <input
                            required
                            className="w-full px-4 py-3 bg-black/40 border border-slate-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-white"
                            placeholder="Web Server Pro"
                            value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })}
                        />
                    </div>
                    <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Sistema Operativo</label>
                        <select
                            className="w-full px-4 py-3 bg-black/40 border border-slate-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-white"
                            value={formData.os} onChange={e => setFormData({ ...formData, os: e.target.value })}
                        >
                            <option value="ubuntu">Ubuntu</option>
                            <option value="debian">Debian</option>
                            <option value="almalinux">Alma/Rocky Linux</option>
                            <option value="centos">CentOS</option>
                        </select>
                    </div>
                    <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Dirección IP</label>
                        <input
                            required
                            className="w-full px-4 py-3 bg-black/40 border border-slate-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-white"
                            placeholder="192.168.1.100"
                            value={formData.ip} onChange={e => setFormData({ ...formData, ip: e.target.value })}
                        />
                    </div>
                    <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Hostname (Opcional)</label>
                        <input
                            className="w-full px-4 py-3 bg-black/40 border border-slate-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-white"
                            placeholder="srv.midominio.com"
                            value={formData.hostname} onChange={e => setFormData({ ...formData, hostname: e.target.value })}
                        />
                    </div>
                </div>

                <div className="pt-6 border-t border-slate-800/50">
                    <h2 className="text-lg font-medium text-white mb-4 flex items-center gap-2">
                        <Shield className="w-5 h-5 text-indigo-400" /> Autenticación SSH
                    </h2>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="space-y-1">
                            <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Puerto SSH</label>
                            <input
                                required type="number"
                                className="w-full px-4 py-3 bg-black/40 border border-slate-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-white"
                                value={formData.sshPort} onChange={e => setFormData({ ...formData, sshPort: e.target.value })}
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Usuario SSH</label>
                            <input
                                required
                                className="w-full px-4 py-3 bg-black/40 border border-slate-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-white"
                                value={formData.sshUser} onChange={e => setFormData({ ...formData, sshUser: e.target.value })}
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Método</label>
                            <select
                                className="w-full px-4 py-3 bg-black/40 border border-slate-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-white"
                                value={formData.authMethod} onChange={e => setFormData({ ...formData, authMethod: e.target.value })}
                            >
                                <option value="KEY">Clave SSH (Ed25519/RSA)</option>
                                <option value="PASSWORD">Contraseña Pura</option>
                            </select>
                        </div>
                    </div>

                    <div className="space-y-1 mt-6">
                        <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider w-full flex items-center justify-between">
                            {formData.authMethod === "KEY" ? "Clave Privada (Private Key Text)" : "Contraseña"}
                            <span className="text-[10px] text-emerald-400 px-2 py-1 bg-emerald-500/10 rounded-md">AES-256-GCM Cifrado</span>
                        </label>
                        {formData.authMethod === "KEY" ? (
                            <textarea
                                required rows={5}
                                className="w-full px-4 py-3 bg-black/40 border border-slate-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-white font-mono text-sm"
                                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----..."
                                value={formData.credential} onChange={e => setFormData({ ...formData, credential: e.target.value })}
                            />
                        ) : (
                            <input
                                required type="password"
                                className="w-full px-4 py-3 bg-black/40 border border-slate-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-white"
                                placeholder="Tu contraseña ultra segura"
                                value={formData.credential} onChange={e => setFormData({ ...formData, credential: e.target.value })}
                            />
                        )}
                        <p className="text-xs text-slate-500 mt-2">La credencial se encripta de manera simétrica antes de persistirse en la base de datos para no dejar rastros en crudo.</p>
                    </div>
                </div>

                <div className="pt-6 border-t border-slate-800/50 flex justify-end">
                    <button
                        type="submit"
                        disabled={loading}
                        className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl shadow-lg shadow-indigo-500/25 flex items-center gap-2 transition-colors font-medium border border-indigo-500/50 disabled:opacity-50"
                    >
                        {loading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save className="w-5 h-5" />}
                        {loading ? "Guardando..." : "Guardar Servidor"}
                    </button>
                </div>
            </form>
        </div>
    );
}
