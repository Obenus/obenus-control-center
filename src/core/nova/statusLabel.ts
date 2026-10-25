import { NovaInstallStatus } from "@prisma/client";

export function statusLabel(status: NovaInstallStatus): string {
    const map: Record<NovaInstallStatus, string> = {
        NOT_INSTALLED: "No instalado",
        INSTALLED: "Instalado y actualizado",
        UPDATE_AVAILABLE: "Actualización disponible",
        INSTALLING: "Instalando",
        UPDATING: "Actualizando",
        INSTALL_ERROR: "Error de instalación",
        CONNECTION_ERROR: "Error de conexión",
        UNKNOWN: "Estado desconocido",
    };
    return map[status] || status;
}
