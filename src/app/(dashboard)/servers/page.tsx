"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Server, Activity, ArrowRight, MoreVertical } from "lucide-react";

type ServerInfo = {
  id: string;
  name: string;
  hostname: string;
  ip: string;
  os: string;
  status: string;
};

export default function ServersPage() {
  const [servers, setServers] = useState<ServerInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/servers")
      .then(res => res.json())
      .then(data => {
        setServers(data);
        setLoading(false);
      });
  }, []);

  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white mb-2">Servidores</h1>
          <p className="text-slate-400">Gestiona y monitoriza tu flota de servidores.</p>
        </div>
        <Link 
          href="/servers/new"
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg shadow-lg shadow-indigo-500/25 flex items-center gap-2 transition-colors font-medium border border-indigo-500/50"
        >
          <Plus className="w-5 h-5" />
          Añadir Servidor
        </Link>
      </div>

      {loading ? (
        <div className="flex justify-center items-center h-64">
           <div className="w-8 h-8 border-2 border-indigo-500 rounded-full border-t-transparent animate-spin"/>
        </div>
      ) : servers.length === 0 ? (
        <div className="glassmorphism rounded-2xl p-12 flex flex-col items-center justify-center text-center border-dashed border-slate-700">
          <div className="w-16 h-16 bg-slate-800/50 rounded-full flex items-center justify-center mb-4">
            <Server className="w-8 h-8 text-slate-400" />
          </div>
          <h3 className="text-xl font-semibold text-white mb-2">No hay servidores</h3>
          <p className="text-slate-400 max-w-sm mb-6">Aún no has registrado ningún servidor. Haz clic en "Añadir Servidor" para empezar a gestionar tu infraestructura.</p>
          <Link 
            href="/servers/new"
            className="px-6 py-3 bg-white/5 hover:bg-white/10 border border-white/10 text-white rounded-lg flex items-center gap-2 transition-colors font-medium"
          >
            <Plus className="w-5 h-5" />
            Configurar Primer Servidor
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {servers.map((server) => (
            <div key={server.id} className="glassmorphism rounded-2xl p-6 group hover:border-indigo-500/30 transition-all cursor-pointer relative flex flex-col min-h-[220px]">
              <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-3">
                  <div className={`p-3 rounded-xl flex items-center justify-center ${server.status === "ACTIVE" ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`}>
                    <Server className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold tracking-tight text-white">{server.name}</h3>
                    <p className="text-xs text-slate-400">{server.ip}</p>
                  </div>
                </div>
                <button className="text-slate-500 hover:text-white transition-colors p-1">
                  <MoreVertical className="w-4 h-4" />
                </button>
              </div>

              <div className="flex gap-2 mb-4">
                <span className="px-2 py-1 text-xs rounded-md bg-slate-800 text-slate-300 font-medium">{server.os}</span>
                <span className="px-2 py-1 text-xs rounded-md bg-slate-800 text-slate-300 font-medium">{server.status}</span>
              </div>

              <div className="mt-auto pt-4 border-t border-slate-800/50 flex justify-between items-center">
                <div className="flex -space-x-1">
                   <div className="w-2 h-2 rounded-full bg-emerald-500 mt-2 ml-1 animate-pulse" />
                   <span className="text-xs text-slate-400 ml-2 mt-[2px]">Online</span>
                </div>
                <Link href={`/servers/${server.id}`} className="text-xs font-semibold text-indigo-400 hover:text-indigo-300 flex items-center gap-1 group-hover:underline">
                  Administrar <ArrowRight className="w-3 h-3 group-hover:translate-x-1 transition-transform" />
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
