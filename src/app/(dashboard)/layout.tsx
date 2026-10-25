"use client";

import { useSession, signOut } from "next-auth/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Server, LayoutDashboard, Settings, LogOut, Loader2, Users, Activity, Command, Menu, X, Radar } from "lucide-react";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
    const { data: session, status } = useSession();
    const pathname = usePathname();
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    if (status === "loading") {
        return (
            <div className="min-h-screen flex items-center justify-center bg-[#050508]">
                <div className="relative">
                    <div className="absolute inset-0 bg-sky-500 rounded-full blur-xl opacity-20 animate-pulse"></div>
                    <Loader2 className="w-8 h-8 animate-spin text-sky-400 relative z-10" />
                </div>
            </div>
        );
    }

    const navItems = [
        { name: "Resumen", href: "/dashboard", icon: LayoutDashboard },
        { name: "Nodos", href: "/servers", icon: Server },
        { name: "Métricas", href: "/monitoring", icon: Activity },
        ...((session?.user as any)?.role === "ADMIN" ? [{ name: "NOVA", href: "/nova", icon: Radar }] : []),
        ...((session?.user as any)?.role === "ADMIN" ? [{ name: "Identidades", href: "/users", icon: Users }] : []),
        { name: "Configuración", href: "/settings", icon: Settings },
    ];

    return (
        <div className="min-h-screen flex text-slate-50 relative selection:bg-sky-500/30">
            {mobileMenuOpen && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 md:hidden" onClick={() => setMobileMenuOpen(false)} />
            )}

            <aside className={`fixed inset-y-0 left-0 w-[280px] border-r border-white-[0.02] bg-[#050508] md:bg-white/[0.01] flex flex-col backdrop-blur-3xl z-50 md:z-10 shadow-[20px_0_40px_-20px_rgba(0,0,0,0.5)] transition-transform duration-300 md:relative md:translate-x-0 ${mobileMenuOpen ? "translate-x-0" : "-translate-x-full"}`}>
                <div className="h-24 flex items-center px-8 border-b border-white/[0.02]">
                    <div className="w-9 h-9 bg-gradient-to-tr from-sky-400 to-indigo-500 rounded-xl shadow-lg shadow-sky-500/20 flex items-center justify-center mr-3 relative overflow-hidden group hover:scale-105 transition-transform">
                        <div className="absolute inset-0 opacity-0 group-hover:opacity-30 bg-[linear-gradient(45deg,transparent_25%,white_50%,transparent_75%)] animate-shimmer" />
                        <Command className="w-4 h-4 text-white relative z-10" />
                    </div>
                    <span className="font-display font-semibold tracking-tight text-white text-xl">Obenus <span className="opacity-50 font-normal">Hub</span></span>
                    <button className="ml-auto md:hidden text-slate-400 hover:text-white" onClick={() => setMobileMenuOpen(false)}>
                        <X className="w-6 h-6" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto py-8 px-4 space-y-2 scrollbar-none">
                    <div className="px-4 mb-5">
                        <p className="text-[10px] uppercase tracking-widest font-black text-slate-600/80">Navigation</p>
                    </div>
                    {navItems.map((item) => {
                        const isActive = pathname.startsWith(item.href);
                        const Icon = item.icon;
                        return (
                            <Link key={item.name} href={item.href}
                                onClick={() => setMobileMenuOpen(false)}
                                className={`flex items-center gap-3.5 px-4 py-3.5 rounded-2xl transition-all duration-300 font-medium text-sm group relative overflow-hidden ${isActive
                                    ? "text-white shadow-lg shadow-black/20"
                                    : "text-slate-400 hover:text-white"
                                    }`}
                            >
                                {isActive && (
                                    <div className="absolute inset-0 bg-gradient-to-r from-sky-500/10 to-transparent border-l-2 border-sky-400 opacity-100" />
                                )}
                                {!isActive && (
                                    <div className="absolute inset-0 bg-white/[0.02] opacity-0 group-hover:opacity-100 transition-opacity" />
                                )}
                                <Icon className={`w-5 h-5 relative z-10 transition-colors ${isActive ? 'text-sky-400' : 'text-slate-500 group-hover:text-slate-300'}`} />
                                <span className="relative z-10 tracking-wide font-display">{item.name}</span>
                            </Link>
                        )
                    })}
                </div>

                <div className="p-6 border-t border-white/[0.02]">
                    <div className="glass-card animated-border rounded-2xl p-4 flex flex-col gap-4">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-slate-800 to-slate-900 border border-white/5 flex items-center justify-center text-sm font-bold uppercase text-slate-300 shadow-inner">
                                {session?.user?.name?.[0] || 'U'}
                            </div>
                            <div className="flex flex-col flex-1 overflow-hidden">
                                <span className="text-xs font-display font-semibold text-white tracking-wide truncate">{session?.user?.name}</span>
                                <span className="text-[9px] text-sky-400 uppercase tracking-widest font-bold truncate mt-0.5">{(session?.user as any)?.role}</span>
                            </div>
                        </div>
                        <div className="h-px w-full bg-white/5" />
                        <button
                            onClick={() => signOut()}
                            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-[11px] font-bold tracking-widest uppercase text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-xl transition-all"
                        >
                            <LogOut className="w-3.5 h-3.5" /> Disconnect
                        </button>
                    </div>
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 flex flex-col min-w-0 z-10 relative">
                <header className="h-24 border-b border-white/[0.02] bg-transparent backdrop-blur-3xl flex items-center px-8 md:px-12 sticky top-0 z-20">
                    <button onClick={() => setMobileMenuOpen(true)} className="md:hidden mr-4 text-slate-300 hover:text-white transition-colors">
                        <Menu className="w-6 h-6" />
                    </button>
                    <div className="md:hidden font-display font-semibold tracking-tight text-white mr-auto flex items-center gap-2">
                        <Command className="w-5 h-5 text-sky-400" /> Obenus Hub
                    </div>
                </header>
                <div className="flex-1 p-6 md:p-12 overflow-y-auto scrollbar-thin scrollbar-thumb-white/10">
                    {children}
                </div>
            </main>
        </div>
    );
}
