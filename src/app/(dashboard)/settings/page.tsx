import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { Shield } from "lucide-react";
import { SettingsForms } from "./SettingsForms";
import { NovaSettingsForm } from "./NovaSettingsForm";
import { TwoFactorForm } from "./TwoFactorForm";
import { getNotificationConfig } from "@/lib/notifications";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
    const session = await getServerSession(authOptions);
    const role = (session?.user as any)?.role;

    if (role !== "ADMIN") {
        return (
            <div className="max-w-4xl mx-auto flex flex-col items-center justify-center min-h-[50vh]">
                <Shield className="w-16 h-16 text-red-500 mb-4 opacity-50" />
                <h1 className="text-2xl font-bold text-white mb-2 font-display">Acceso Denegado</h1>
                <p className="text-slate-400">Sólo los superusuarios (ADMIN) pueden acceder a la configuración global del sistema.</p>
            </div>
        );
    }

    const { smtp } = await getNotificationConfig();

    const safeSmtp = {
        ...smtp,
        pass: "",
        hasPass: Boolean(smtp.pass),
    };

    return (
        <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in duration-500">
            <div>
                <h1 className="text-3xl font-bold tracking-tight text-white mb-2 font-display">Configuración Global</h1>
                <p className="text-slate-400">
                    SMTP para avisos del Hub. Telegram se configura solo en la sección NOVA (un único bot para monitorización y alertas del centro).
                </p>
            </div>

            <SettingsForms initialSmtp={safeSmtp} />

            <TwoFactorForm />

            <NovaSettingsForm />

            <p className="text-center text-xs text-slate-600 font-bold tracking-[0.2em] uppercase mt-12 pb-4">
                Obenus Control Center - V1.0.0
            </p>
        </div>
    );
}
