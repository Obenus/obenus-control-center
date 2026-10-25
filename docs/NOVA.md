# Módulo NOVA — Obenus Control Center

Gestión centralizada del agente de monitorización **Obenus NOVA** (`obenus-nova.py`).

## Qué hace

- Inventario de estado NOVA por servidor (versión, SHA-256, alertas, módulos).
- Instalación / actualización / reinstalación / migración vía SSH desde el worker.
- Configuración Telegram cifrada (AES-256-GCM) y distribución segura por SFTP.
- Actualización masiva con bloqueo anti-concurrencia por servidor.
- El agente sigue enviando alertas a Telegram de forma autónoma (no depende del Control Center).

## Uso

1. **Configuración → NOVA**: token Telegram, Chat ID, umbrales e informe diario. Usar «Probar Telegram».
2. **Menú NOVA**: tabla de servidores, filtros, instalación/actualización individual o masiva.
3. **Subir nueva versión**: botón «Subir nueva versión» con un `obenus-nova.py` (valida `VERSION` y modos `--install`/`--run`). Queda como oficial; luego «Comprobar todos» + «Actualización masiva».
4. **Ficha del servidor → panel NOVA**: diagnóstico, módulos, historial de operaciones.
5. Al crear un servidor, marcar «Instalar NOVA automáticamente» (solo ADMIN).

## Arquitectura

| Pieza | Ubicación |
|-------|-----------|
| Agente oficial | `/obenus-nova.py` (montado en app/worker) |
| Servicio SSH | `src/core/nova/novaService.ts` |
| Cola BullMQ | jobs `nova-*` en `server-tasks` |
| API | `/api/nova/*` |
| UI | `/nova`, settings `#nova`, panel en `/servers/[id]` |
| Persistencia | modelos `NovaAgent`, `NovaOperation` |

## Seguridad

- Acciones de escritura: solo rol **ADMIN**.
- Secretos cifrados; nunca en logs/API; subida SFTP mode `600`.
- Comandos remotos sin concatenar input de UI en shell.
- Locks Redis + `operationLockUntil` para evitar dobles operaciones.

## Corrección multi-servidor

Las rutinas programadas (BullMQ repeatable) usan `jobId` único `sched_{serverId}_{task}` para que el mismo cron en varios nodos no se sobrescriba.
