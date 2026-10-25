# Obenus Control Center

**Obenus Control Center** es una aplicación SaaS autohospedada, diseñada para centralizar la administración y el mantenimiento de servidores VPS Linux en entornos multiusuario. Permite monitorizar en tiempo real, ejecutar tareas remotas seguras mediante SSH, gestionar notificaciones móviles y de correo, y auditar historiales.

## 🚀 Características Principales

1. **Gestión de Servidores Multi-Tenant**: Administra diferentes servidores Linux, clasificados por entorno, etiquetas y propietario.
2. **Monitorización en Tiempo Real**: Dashboards interactivos con información de CPU, RAM, Swap, Disco, Uptime y estado de servicios críticos (Docker, Nginx, MySQL, etc.).
3. **Tareas Remotas Seguras (Whitelist)**: Ejecuta operaciones de mantenimiento predefinidas (ej. Limpieza de logs, actualización de paquetes, reseteos de servicios) en los servidores conectados. 
4. **Notificaciones Inteligentes**: Sistema de alertas integrado utilizando Telegram Bot y mensajería SMTP para avisar sobre límites de umbral superados y estados de tareas.
5. **Auditoría Exhaustiva**: Historiales de ejecución, auditoría de eventos de administradores y guardado de métricas clave continuas.
6. **Docker Deck**: Control visual de contenedores remotos (Star/Stop/Restart/Delete) directamente desde la interfaz.
7. **Telemetría Histórica**: Gráficas de rendimiento (CPU/RAM) de las últimas 24 horas mediante Recharts.
8. **Disparadores Sensoriales (Auto-Action)**: Reglas autónomas para ejecutar scripts automáticamente si se superan umbrales de rendimiento.
9. **Seguridad Avanzada**: Cifrado AES-256 para credenciales, aislamiento de variables, y entorno dockerizado completo.

---

## 🛠️ Stack Tecnológico y Arquitectura

* **Frontend y Backend**: Next.js (App Router) + TypeScript.
* **Interfaz**: Tailwind CSS con un diseño premium y responsive impulsado por UX moderno.
* **Base de Datos**: PostgreSQL + Prisma ORM.
* **Procesamiento de Tareas**: BullMQ sobre Redis (con Worker Node separado de la App Web para evitar timeouts).
* **Infraestructura**: Orientado a contenedores (Docker y Docker Compose).

---

## 📋 Requisitos Previos

- Docker (v24+) y Docker Compose (v2.20+)
- Node.js (v20+) y npm (si vas a desarrollar en local sin Docker)
- Git

## ⚙️ Instalación (Producción y Desarrollo local con Docker)

El entorno se encuentra completamente dockerizado para facilitar su inicio.

1. **Clona el ecosistema:**
   ```bash
   git clone https://github.com/tu-usuario/obenus-control-center.git
   cd obenus-control-center
   ```

2. **Configura el entorno de Variables:**
   ```bash
   cp .env.example .env
   # Edita el .env introduciendo credenciales seguras, JWT Secrets, y claves SSH.
   ```

3. **Inicia Docker Compose:**
   ```bash
   # Construir e iniciar contenedores
   docker compose up -d --build
   ```

4. **Accede a la Interfaz:**
   Abre tu navegador y ve a `http://localhost:3000`. 
   El usuario administrador inicial estará definido por las variables `ADMIN_EMAIL` y `ADMIN_PASSWORD` definidas en tu `.env`.

---

## 🏗️ Estructura del Proyecto

* **`/src/app/`**: Rutas de Next.js. Las rutas de la API, Dashboard, Autenticación.
* **`/src/components/`**: Módulos visuales aislados e individuales. (Botones, Tablas, Gráficas, HOCs).
* **`/src/core/`**: Reglas de negocio puras. Funciones de conexión SSH, validación y formateo.
* **`/src/worker/`**: Aplicación CLI Worker que corre BullMQ para ejecutar las colas sin bloquear la web.
* **`/prisma/`**: Modelos de datos `schema.prisma`.
* **`/deployment/`**: Ficheros de soporte DevOps (Nginx configs adicionales, Dockerfiles).

---

## 🛰️ Módulo NOVA

Gestión centralizada del agente de monitorización autónomo. Ver [docs/NOVA.md](docs/NOVA.md).

* Menú **NOVA** (administradores): inventario, instalación/actualización masiva.
* Configuración → **NOVA**: Telegram cifrado y umbrales.
* Ficha de servidor → panel **NOVA**.

## 🗺️ Roadmap Actual

* **Fase 1-5 (Completadas):** Arquitectura, Dockerización, Autenticación, Ejecución SSH, Alertas Telegram/SMTP, Telemetría Visual y Triggers Autónomos.
* **NOVA:** Administración centralizada del agente de monitorización.
* **Fase Actual:** Versión 1.0 + NOVA.

---

## 🔒 Seguridad
Las credenciales remotas se almacenan cifradas en la Base de Datos. Aconsejamos fervientemente usar autenticación asimétrica (Claves Ed25519) antes que contraseñas en SSH. Las peticiones y ejecuciones están estrictamente parametrizadas por la lógica de Back-End.

---
📅 *Documento en constante actualización durante el desarrollo.*
