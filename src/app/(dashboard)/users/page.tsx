"use client";

import { useEffect, useState } from "react";
import { Plus, Users as UsersIcon, ShieldAlert, CheckCircle2, XCircle } from "lucide-react";
import Link from "next/link";
import { useSession } from "next-auth/react";

type UserInfo = {
    id: string;
    name: string;
    email: string;
    role: string;
    isActive: boolean;
};

export default function UsersPage() {
    const { data: session } = useSession();
    const [users, setUsers] = useState<UserInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [editingUser, setEditingUser] = useState<any>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [formData, setFormData] = useState({ id: "", name: "", email: "", password: "", role: "USER" });

    const fetchUsers = () => {
        fetch("/api/users")
            .then(res => res.json())
            .then(data => {
                setUsers(data);
                setLoading(false);
            });
    };

    useEffect(() => {
        if ((session?.user as any)?.role !== "ADMIN") return;

        if ((session?.user as any)?.role !== "ADMIN") return;
        fetchUsers();
    }, [session]);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        const method = formData.id ? "PUT" : "POST";
        await fetch("/api/users", {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(formData)
        });
        setIsModalOpen(false);
        fetchUsers();
    };

    const openCreate = () => {
        setFormData({ id: "", name: "", email: "", password: "", role: "USER" });
        setIsModalOpen(true);
    };

    const openEdit = (user: UserInfo) => {
        setFormData({ id: user.id, name: user.name, email: user.email, password: "", role: user.role });
        setIsModalOpen(true);
    };

    if ((session?.user as any)?.role !== "ADMIN") {
        return (
            <div className="flex flex-col items-center justify-center h-[60vh] animate-in zoom-in fade-in duration-500">
                <ShieldAlert className="w-20 h-20 text-red-500 mb-6 drop-shadow-[0_0_15px_rgba(239,68,68,0.5)]" />
                <h2 className="text-3xl font-bold text-white tracking-tight mb-2">Acceso Denegado</h2>
                <p className="text-slate-400 text-lg">Solo los administradores pueden gestionar la base de usuarios.</p>
            </div>
        );
    }

    return (
        <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in duration-500">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-white mb-2">Usuarios</h1>
                    <p className="text-slate-400">Gestiona accesos, roles y miembros de tu organización.</p>
                </div>
                <button
                    onClick={openCreate}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg shadow-lg shadow-indigo-500/25 flex items-center gap-2 transition-colors font-medium border border-indigo-500/50"
                >
                    <Plus className="w-5 h-5" /> Añadir Usuario
                </button>
            </div>

            <div className="glassmorphism rounded-2xl border border-white/5 overflow-hidden shadow-2xl">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse min-w-max">
                        <thead>
                            <tr className="border-b border-white/5 bg-black/40">
                                <th className="px-6 py-5 font-semibold text-xs uppercase tracking-wider text-slate-300">Usuario</th>
                                <th className="px-6 py-5 font-semibold text-xs uppercase tracking-wider text-slate-300">Email</th>
                                <th className="px-6 py-5 font-semibold text-xs uppercase tracking-wider text-slate-300">Rol</th>
                                <th className="px-6 py-5 font-semibold text-xs uppercase tracking-wider text-slate-300">Estado</th>
                                <th className="px-6 py-5 font-semibold text-xs uppercase tracking-wider text-slate-300 text-right">Acciones</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan={5} className="p-12 text-center">
                                        <div className="flex justify-center items-center gap-3 text-slate-400">
                                            <div className="w-5 h-5 border-2 border-indigo-500 rounded-full border-t-transparent animate-spin" />
                                            Cargando lista de usuarios...
                                        </div>
                                    </td>
                                </tr>
                            ) : users.map(user => (
                                <tr key={user.id} className="border-b border-white/5 hover:bg-white/5 transition-colors group">
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-full bg-slate-800 flex flex-shrink-0 items-center justify-center text-xs font-bold text-white">
                                                {user.name.charAt(0).toUpperCase()}
                                            </div>
                                            <span className="text-sm font-medium text-white tracking-tight">{user.name}</span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-sm text-slate-400">{user.email}</td>
                                    <td className="px-6 py-4 text-sm">
                                        <span className={`px-2.5 py-1 rounded-md text-xs font-bold tracking-wide ${user.role === 'ADMIN' ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/20' : 'bg-slate-800 text-slate-300 border border-slate-700'}`}>
                                            {user.role}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-sm">
                                        {user.isActive ? (
                                            <span className="flex items-center gap-1.5 text-emerald-400 text-xs font-medium">
                                                <CheckCircle2 className="w-4 h-4" /> Activo
                                            </span>
                                        ) : (
                                            <span className="flex items-center gap-1.5 text-red-400 text-xs font-medium">
                                                <XCircle className="w-4 h-4" /> Inactivo
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-6 py-4 text-sm text-right">
                                        <button onClick={() => openEdit(user)} className="text-indigo-400 hover:text-indigo-300 font-medium opacity-0 group-hover:opacity-100 transition-opacity">Editar</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {isModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
                    <div className="bg-[#0b0c10] border border-white/10 rounded-2xl w-full max-w-md shadow-2xl p-6">
                        <h2 className="text-xl font-bold text-white mb-4">{formData.id ? "Editar Usuario" : "Añadir Usuario"}</h2>
                        <form onSubmit={handleSave} className="space-y-4">
                            <div>
                                <label className="text-xs uppercase tracking-widest text-slate-500 font-bold mb-1 block">Nombre</label>
                                <input required value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-slate-200 text-sm focus:border-indigo-500 focus:outline-none" />
                            </div>
                            <div>
                                <label className="text-xs uppercase tracking-widest text-slate-500 font-bold mb-1 block">Correo</label>
                                <input type="email" required value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-slate-200 text-sm focus:border-indigo-500 focus:outline-none" />
                            </div>
                            <div>
                                <label className="text-xs uppercase tracking-widest text-slate-500 font-bold mb-1 block">Contraseña {formData.id && "(Dejar en blanco para no modificar)"}</label>
                                <input type="password" required={!formData.id} value={formData.password} onChange={e => setFormData({ ...formData, password: e.target.value })} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-slate-200 text-sm focus:border-indigo-500 focus:outline-none" />
                            </div>
                            <div>
                                <label className="text-xs uppercase tracking-widest text-slate-500 font-bold mb-1 block">Rol</label>
                                <select value={formData.role} onChange={e => setFormData({ ...formData, role: e.target.value })} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-slate-200 text-sm focus:border-indigo-500 focus:outline-none">
                                    <option value="USER">USER</option>
                                    <option value="ADMIN">ADMIN</option>
                                </select>
                            </div>
                            <div className="flex gap-4 pt-4">
                                <button type="button" onClick={() => setIsModalOpen(false)} className="w-full py-3 rounded-xl bg-white/5 hover:bg-white/10 text-white text-sm font-bold transition-colors">Cancelar</button>
                                <button type="submit" className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold transition-colors shadow-lg shadow-indigo-500/20">Guardar</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
