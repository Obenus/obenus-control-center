import { NovaInstallStatus, Server } from "@prisma/client";
import { prisma } from "../../lib/auth";
import { getNovaConfig, redactSecrets } from "../../lib/novaConfig";
import { executeSSHCommand, testSSHConnectivity, uploadSSHFile } from "../ssh/sshService";
import { compareAgentHash, loadOfficialAgent } from "./agentPackage";
import { acquireNovaLock, releaseNovaLock } from "./locks";

const REMOTE_AGENT = "/usr/local/sbin/obenus-nova.py";
const REMOTE_CONFIG = "/etc/obenus-monitor/nova.json";
const REMOTE_STATE = "/var/lib/obenus-monitor/nova-state.json";
const REMOTE_CRON = "/etc/cron.d/obenus-nova";
const LEGACY_CRONS = [
    "/etc/cron.d/obenus-alertas",
    "/etc/cron.d/obenus-monitor",
    "/etc/cron.d/nova-s3-monitor",
];

export type NovaProbeResult = {
    connected: boolean;
    installStatus: NovaInstallStatus;
    installedVersion: string | null;
    installedSha256: string | null;
    officialVersion: string;
    officialSha256: string;
    lastRunAt: string | null;
    activeAlerts: number;
    monitoringStatus: string;
    capabilities: {
        docker: boolean;
        plesk: boolean;
        s3: boolean;
        pythonOk: boolean;
        distro: string;
        isRootCapable: boolean;
    };
    modules: {
        linux: boolean;
        docker: boolean;
        plesk: boolean;
        s3: boolean;
    };
    legacyDetected: string[];
    lastError: string | null;
    raw?: string;
};

function mapStatus(probe: Partial<NovaProbeResult>, officialSha: string): NovaInstallStatus {
    if (!probe.connected) return "CONNECTION_ERROR";
    if (!probe.installedSha256) return "NOT_INSTALLED";
    if (compareAgentHash(probe.installedSha256, officialSha)) return "INSTALLED";
    return "UPDATE_AVAILABLE";
}

async function ensureAgentRow(serverId: string) {
    return prisma.novaAgent.upsert({
        where: { serverId },
        update: {},
        create: { serverId, installStatus: "UNKNOWN" },
    });
}

export async function probeServerNova(server: Server): Promise<NovaProbeResult> {
    const official = await loadOfficialAgent();
    const base: NovaProbeResult = {
        connected: false,
        installStatus: "UNKNOWN",
        installedVersion: null,
        installedSha256: null,
        officialVersion: official.version,
        officialSha256: official.sha256,
        lastRunAt: null,
        activeAlerts: 0,
        monitoringStatus: "unknown",
        capabilities: {
            docker: false,
            plesk: false,
            s3: false,
            pythonOk: false,
            distro: "unknown",
            isRootCapable: false,
        },
        modules: { linux: true, docker: false, plesk: false, s3: false },
        legacyDetected: [],
        lastError: null,
    };

    const connectivity = await testSSHConnectivity(server);
    if (!connectivity.ok) {
        return { ...base, installStatus: "CONNECTION_ERROR", lastError: connectivity.message };
    }
    base.connected = true;

    // Single remote probe script — no secrets, JSON stdout only
    const probeScript = `
import json, os, shutil, hashlib, platform
from pathlib import Path
TARGET=Path(${JSON.stringify(REMOTE_AGENT)})
CONFIG=Path(${JSON.stringify(REMOTE_CONFIG)})
STATE=Path(${JSON.stringify(REMOTE_STATE)})
CRON=Path(${JSON.stringify(REMOTE_CRON)})
LEGACY=${JSON.stringify(LEGACY_CRONS)}
LEGACY_SCRIPTS=[
  "/usr/local/sbin/obenus-alertas.py",
  "/usr/local/sbin/obenus-monitor.sh",
  "/usr/local/sbin/nova-s3-monitor.py",
  "/usr/sbin/obenus-alertas.py",
  "/usr/sbin/obenus-monitor.sh",
]
out={
  "python_ok": True,
  "distro": "",
  "uid": os.geteuid() if hasattr(os,"geteuid") else -1,
  "docker": bool(shutil.which("docker")),
  "plesk": bool(shutil.which("plesk")),
  "agent_exists": TARGET.exists(),
  "sha256": None,
  "version": None,
  "cron": CRON.exists(),
  "last_run": None,
  "alerts": 0,
  "modules": {"linux": True, "docker": False, "plesk": False, "s3": False},
  "s3_enabled": False,
  "legacy": [p for p in LEGACY if Path(p).exists()],
  "legacy_scripts": [p for p in LEGACY_SCRIPTS if Path(p).is_file()],
}
try:
  import distro as d
  out["distro"]=d.id()
except Exception:
  # Alma/RHEL: leer /etc/os-release sin depender del paquete distro
  try:
    for line in Path("/etc/os-release").read_text().splitlines():
      if line.startswith("ID="):
        out["distro"]=line.split("=",1)[1].strip().strip('"')
        break
    if not out["distro"]:
      out["distro"]=platform.system().lower()
  except Exception:
    out["distro"]=platform.system().lower()
if TARGET.exists():
  data=TARGET.read_bytes()
  out["sha256"]=hashlib.sha256(data).hexdigest()
  import re
  m=re.search(rb"VERSION\\s*=\\s*['\\\"]([^'\\\"]+)['\\\"]", data)
  out["version"]=m.group(1).decode() if m else None
if STATE.exists():
  try:
    st=json.loads(STATE.read_text())
    out["last_run"]=st.get("last_run")
    out["alerts"]=sum(1 for x in st.get("alerts",{}).values() if x.get("notified"))
  except Exception:
    pass
if CONFIG.exists():
  try:
    cfg=json.loads(CONFIG.read_text())
    out["s3_enabled"]=bool(cfg.get("s3_enabled"))
    out["modules"]={
      "linux": True,
      "docker": bool(shutil.which("docker")),
      "plesk": bool(cfg.get("plesk_ssl_autodiscovery")) or bool(shutil.which("plesk")),
      "s3": bool(cfg.get("s3_enabled")),
    }
  except Exception:
    pass
else:
  out["modules"]["docker"]=out["docker"]
  out["modules"]["plesk"]=out["plesk"]
print(json.dumps(out))
`.trim();

    try {
        const remoteTmp = `/tmp/.nova-probe-${Date.now()}.py`;
        await uploadSSHFile(server, remoteTmp, probeScript, 0o700, 25000);
        const { stdout, stderr, code } = await executeSSHCommand(
            server,
            `python3 ${remoteTmp}; ec=$?; rm -f ${remoteTmp}; exit $ec`,
            { timeoutMs: 25000 }
        );
        if (code !== 0) {
            return {
                ...base,
                installStatus: "UNKNOWN",
                lastError: redactSecrets((stderr || stdout || "probe failed").slice(0, 300)),
            };
        }
        const data = JSON.parse(stdout.trim().split("\n").pop() || "{}");
        base.capabilities = {
            docker: Boolean(data.docker),
            plesk: Boolean(data.plesk),
            s3: Boolean(data.s3_enabled) || (Boolean(data.plesk) && Boolean(data.s3_enabled)),
            pythonOk: Boolean(data.python_ok),
            distro: String(data.distro || "unknown"),
            isRootCapable: Number(data.uid) === 0,
        };
        base.installedSha256 = data.sha256 || null;
        base.installedVersion = data.version || null;
        base.lastRunAt = data.last_run || null;
        base.activeAlerts = Number(data.alerts || 0);
        base.modules = data.modules || base.modules;
        base.legacyDetected = Array.isArray(data.legacy) ? data.legacy : [];
        // También detectar scripts legacy aunque /etc/cron.d aún no esté listado
        if (!data.agent_exists && Array.isArray(data.legacy_scripts)) {
            for (const p of data.legacy_scripts) {
                if (p && !base.legacyDetected.includes(p)) base.legacyDetected.push(p);
            }
        }
        base.monitoringStatus = data.agent_exists
            ? (base.activeAlerts > 0 ? "degraded" : "ok")
            : (base.legacyDetected.length ? "legacy" : "unknown");
        base.installStatus = mapStatus(base, official.sha256);
        if (base.installStatus === "NOT_INSTALLED" && base.legacyDetected.length) {
            base.lastError = `Instalación antigua detectada (${base.legacyDetected.length} restos). Use Migrar para instalar el agente unificado.`;
        }
        base.raw = stdout.slice(0, 2000);
        return base;
    } catch (e: any) {
        return {
            ...base,
            installStatus: "CONNECTION_ERROR",
            lastError: redactSecrets(e?.message || "Error de sonda NOVA"),
        };
    }
}

export async function persistProbe(serverId: string, probe: NovaProbeResult) {
    await ensureAgentRow(serverId);
    await prisma.novaAgent.update({
        where: { serverId },
        data: {
            installStatus: probe.installStatus,
            installedVersion: probe.installedVersion,
            installedSha256: probe.installedSha256,
            lastCheckedAt: new Date(),
            lastRunAt: probe.lastRunAt ? new Date(probe.lastRunAt) : undefined,
            monitoringStatus: probe.monitoringStatus,
            activeAlerts: probe.activeAlerts,
            modules: JSON.stringify(probe.modules),
            capabilities: JSON.stringify(probe.capabilities),
            lastError: probe.lastError,
        },
    });
}

async function pushTelegramEnvFile(server: Server, remoteEnvPath: string) {
    const cfg = await getNovaConfig();
    if (!cfg.botToken || !cfg.chatId) return false;
    // Secrets only via SFTP file (mode 600), never as process argv
    const body = [
        `NOVA_TELEGRAM_TOKEN='${cfg.botToken.replace(/'/g, `'\"'\"'`)}'`,
        `NOVA_TELEGRAM_CHAT_ID='${cfg.chatId.replace(/'/g, `'\"'\"'`)}'`,
        "",
    ].join("\n");
    await uploadSSHFile(server, remoteEnvPath, body, 0o600, 20000);
    return true;
}

async function applyThresholdsRemote(server: Server) {
    const novaCfg = await getNovaConfig();
    const agent = await prisma.novaAgent.findUnique({ where: { serverId: server.id } });
    let modules = { linux: true, docker: true, plesk: true, s3: false };
    let thresholds = novaCfg.thresholds;
    try {
        if (agent?.modules) modules = { ...modules, ...JSON.parse(agent.modules) };
        if (agent?.thresholds) thresholds = { ...thresholds, ...JSON.parse(agent.thresholds) };
    } catch { /* keep defaults */ }

    const mergeScript = `
import json
from pathlib import Path
cfg_path=Path(${JSON.stringify(REMOTE_CONFIG)})
cfg=json.loads(cfg_path.read_text()) if cfg_path.exists() else {}
cfg['memory_threshold']=${Number(thresholds.memory)}
cfg['disk_threshold']=${Number(thresholds.disk)}
cfg['docker_memory_threshold']=${Number(thresholds.dockerMemory)}
cfg['ssl_days_threshold']=${Number(thresholds.sslDays)}
cfg['backup_max_age_hours']=${Number(thresholds.backupMaxAgeHours)}
cfg['report_hour']=${Number(novaCfg.reportHour)}
modules=${JSON.stringify(modules)}
if not modules.get('plesk'):
  cfg['plesk_ssl_autodiscovery']=False
if not modules.get('s3'):
  cfg['s3_enabled']=False
cfg_path.parent.mkdir(parents=True, exist_ok=True)
tmp=cfg_path.with_suffix('.tmp')
tmp.write_text(json.dumps(cfg, indent=2)+'\\n')
tmp.chmod(0o600)
tmp.replace(cfg_path)
print('OK')
`;
    const remote = `/tmp/.nova-merge-${Date.now()}.py`;
    await uploadSSHFile(server, remote, mergeScript, 0o700);
    await executeSSHCommand(server, `python3 ${remote}; rm -f ${remote}`, { timeoutMs: 20000 });
}

async function disableLegacyCrons(server: Server, legacyPaths: string[]) {
    const allowed = legacyPaths.filter((p) => LEGACY_CRONS.includes(p));
    if (!allowed.length) return;
    // cronie (Alma/RHEL) puede seguir ejecutando ficheros *.disabled dentro de /etc/cron.d.
    // Sacar el legacy a /etc/obenus-monitor/legacy-cron/.
    const script = `
import shutil, time
from pathlib import Path
paths=${JSON.stringify(allowed)}
stamp=time.strftime('%Y%m%d-%H%M%S')
legacy_dir=Path('/etc/obenus-monitor/legacy-cron')
legacy_dir.mkdir(parents=True, exist_ok=True)
for p in paths:
  src=Path(p)
  if not src.is_file():
    continue
  bak=legacy_dir / (src.name + '.bak-nova-' + stamp)
  shutil.copy2(str(src), str(bak))
  dest=legacy_dir / (src.name + '.disabled')
  src.replace(dest)
  print('moved', p, '->', dest, 'backup', bak)
# También barrer variantes .disabled/.bak que pudieran quedar en cron.d
for pattern in ('obenus-alertas*', 'obenus-monitor*', 'nova-s3-monitor*'):
  for path in Path('/etc/cron.d').glob(pattern):
    if path.name == 'obenus-nova':
      continue
    dest=legacy_dir / path.name
    shutil.move(str(path), str(dest))
    print('swept', path, '->', dest)
`;
    const remote = `/tmp/.nova-legacy-${Date.now()}.py`;
    await uploadSSHFile(server, remote, script, 0o700);
    await executeSSHCommand(server, `python3 ${remote}; rm -f ${remote}`, { timeoutMs: 20000 });
}

export type NovaOpType = "install" | "update" | "reinstall" | "diagnose" | "refresh" | "test_telegram" | "configure" | "migrate";

export async function runNovaOperation(
    server: Server,
    type: NovaOpType,
    userId?: string | null,
    options?: { force?: boolean; disableLegacy?: boolean }
) {
    const agent = await ensureAgentRow(server.id);
    const locked = await acquireNovaLock(server.id);
    if (!locked) {
        throw new Error("Ya hay una operación NOVA en curso en este servidor");
    }

    const op = await prisma.novaOperation.create({
        data: {
            agentId: agent.id,
            type,
            status: "RUNNING",
            userId: userId || null,
            progress: "Iniciando",
        },
    });

    const secrets: string[] = [];
    try {
        const cfg = await getNovaConfig();
        if (cfg.botToken) secrets.push(cfg.botToken);
        if (cfg.chatId) secrets.push(cfg.chatId);

        if (type === "refresh") {
            await prisma.novaOperation.update({ where: { id: op.id }, data: { progress: "Sondeando" } });
            const probe = await probeServerNova(server);
            await persistProbe(server.id, probe);
            await prisma.novaOperation.update({
                where: { id: op.id },
                data: {
                    status: "SUCCESS",
                    progress: "Completado",
                    stdout: redactSecrets(JSON.stringify({
                        installStatus: probe.installStatus,
                        version: probe.installedVersion,
                        sha256: probe.installedSha256,
                        alerts: probe.activeAlerts,
                    }), secrets),
                    finishedAt: new Date(),
                    durationMs: Date.now() - op.startedAt.getTime(),
                },
            });
            return { operationId: op.id, probe };
        }

        if (type === "diagnose") {
            const { stdout, stderr, code } = await executeSSHCommand(
                server,
                `test -f ${REMOTE_AGENT} && python3 ${REMOTE_AGENT} --diagnose || echo 'NOVA no instalado'`,
                { timeoutMs: 30000 }
            );
            const probe = await probeServerNova(server);
            await persistProbe(server.id, probe);
            await prisma.novaOperation.update({
                where: { id: op.id },
                data: {
                    status: code === 0 ? "SUCCESS" : "ERROR",
                    stdout: redactSecrets(stdout, secrets),
                    stderr: redactSecrets(stderr, secrets),
                    progress: "Diagnóstico finalizado",
                    finishedAt: new Date(),
                    durationMs: Date.now() - op.startedAt.getTime(),
                },
            });
            return { operationId: op.id, probe, stdout: redactSecrets(stdout, secrets) };
        }

        if (type === "test_telegram") {
            const { stdout, stderr, code } = await executeSSHCommand(
                server,
                `test -f ${REMOTE_AGENT} && python3 ${REMOTE_AGENT} --test-telegram || echo 'NOVA no instalado'`,
                { timeoutMs: 30000 }
            );
            await prisma.novaOperation.update({
                where: { id: op.id },
                data: {
                    status: code === 0 && !stdout.includes("no instalado") ? "SUCCESS" : "ERROR",
                    stdout: redactSecrets(stdout, secrets),
                    stderr: redactSecrets(stderr, secrets),
                    progress: "Prueba Telegram",
                    finishedAt: new Date(),
                    durationMs: Date.now() - op.startedAt.getTime(),
                },
            });
            return { operationId: op.id, ok: code === 0 };
        }

        // install / update / reinstall / migrate / configure
        const busyStatus: NovaInstallStatus =
            type === "update" ? "UPDATING" : "INSTALLING";
        await prisma.novaAgent.update({
            where: { serverId: server.id },
            data: { installStatus: busyStatus, lastError: null, lastOperationId: op.id },
        });

        await prisma.novaOperation.update({ where: { id: op.id }, data: { progress: "Comprobando SSH y Python" } });
        const probeBefore = await probeServerNova(server);
        if (!probeBefore.connected) {
            throw new Error(probeBefore.lastError || "Sin conectividad SSH");
        }
        if (!probeBefore.capabilities.pythonOk) {
            throw new Error("Python 3 no disponible en el servidor");
        }
        if (!probeBefore.capabilities.isRootCapable && (server.sshUser || "root") !== "root") {
            // Still attempt — install requires root; surface clear error from agent if fails
        }

        const official = await loadOfficialAgent();
        const needsInstall =
            type === "reinstall" ||
            type === "migrate" ||
            options?.force ||
            !compareAgentHash(probeBefore.installedSha256, official.sha256) ||
            type === "install" ||
            type === "configure";

        if (!needsInstall && type === "update") {
            await persistProbe(server.id, probeBefore);
            await prisma.novaOperation.update({
                where: { id: op.id },
                data: {
                    status: "SUCCESS",
                    progress: "Ya actualizado (SHA-256 idéntico)",
                    stdout: "SKIPPED_SAME_HASH",
                    finishedAt: new Date(),
                    durationMs: Date.now() - op.startedAt.getTime(),
                },
            });
            return { operationId: op.id, skipped: true, probe: probeBefore };
        }

        await prisma.novaOperation.update({ where: { id: op.id }, data: { progress: "Subiendo agente oficial" } });
        const stagePath = `/tmp/obenus-nova-stage-${Date.now()}.py`;
        const envPath = `/tmp/.nova-env-${Date.now()}`;
        await uploadSSHFile(server, stagePath, official.content, 0o700, 60000);

        const hasCreds = await pushTelegramEnvFile(server, envPath);

        const installFlags: string[] = ["--install"];
        if (probeBefore.capabilities.plesk) installFlags.push("--plesk-ssl");
        // S3 only when plesk present; agent also auto-detects
        if (probeBefore.capabilities.plesk) {
            // leave auto-detect; optional force later via modules
        }

        await prisma.novaOperation.update({ where: { id: op.id }, data: { progress: "Instalando / actualizando" } });
        const installCmd = hasCreds
            ? `set -a; . ${envPath}; set +a; python3 ${stagePath} ${installFlags.join(" ")}; ec=$?; rm -f ${envPath} ${stagePath}; exit $ec`
            : `python3 ${stagePath} ${installFlags.join(" ")}; ec=$?; rm -f ${stagePath}; exit $ec`;

        const { stdout, stderr, code } = await executeSSHCommand(server, installCmd, { timeoutMs: 120000 });
        const safeOut = redactSecrets(stdout, secrets);
        const safeErr = redactSecrets(stderr, secrets);

        if (code !== 0) {
            await prisma.novaAgent.update({
                where: { serverId: server.id },
                data: { installStatus: "INSTALL_ERROR", lastError: (safeErr || safeOut).slice(0, 500) },
            });
            await prisma.novaOperation.update({
                where: { id: op.id },
                data: {
                    status: "ERROR",
                    stdout: safeOut,
                    stderr: safeErr,
                    progress: "Error de instalación",
                    finishedAt: new Date(),
                    durationMs: Date.now() - op.startedAt.getTime(),
                },
            });
            return { operationId: op.id, ok: false, stdout: safeOut, stderr: safeErr };
        }

        await prisma.novaOperation.update({ where: { id: op.id }, data: { progress: "Aplicando umbrales y módulos" } });
        try {
            await applyThresholdsRemote(server);
        } catch {
            /* non-fatal */
        }

        if ((type === "migrate" || options?.disableLegacy) && probeBefore.legacyDetected.length) {
            await prisma.novaOperation.update({ where: { id: op.id }, data: { progress: "Desactivando monitores legacy" } });
            await disableLegacyCrons(server, probeBefore.legacyDetected);
        }

        await prisma.novaOperation.update({ where: { id: op.id }, data: { progress: "Verificando estado" } });
        const probeAfter = await probeServerNova(server);
        await persistProbe(server.id, probeAfter);

        const success =
            probeAfter.installStatus === "INSTALLED" ||
            probeAfter.installStatus === "UPDATE_AVAILABLE";

        await prisma.novaOperation.update({
            where: { id: op.id },
            data: {
                status: success ? "SUCCESS" : "ERROR",
                stdout: safeOut,
                stderr: safeErr,
                progress: success ? "Completado" : "Instalación incompleta",
                finishedAt: new Date(),
                durationMs: Date.now() - op.startedAt.getTime(),
            },
        });

        return { operationId: op.id, ok: success, probe: probeAfter, stdout: safeOut };
    } catch (e: any) {
        const msg = redactSecrets(e?.message || "Error NOVA", secrets);
        await prisma.novaAgent.update({
            where: { serverId: server.id },
            data: {
                installStatus: msg.toLowerCase().includes("ssh") || msg.toLowerCase().includes("connect")
                    ? "CONNECTION_ERROR"
                    : "INSTALL_ERROR",
                lastError: msg.slice(0, 500),
            },
        });
        await prisma.novaOperation.update({
            where: { id: op.id },
            data: {
                status: "ERROR",
                stderr: msg,
                progress: "Fallido",
                finishedAt: new Date(),
                durationMs: Date.now() - op.startedAt.getTime(),
            },
        });
        throw e;
    } finally {
        await releaseNovaLock(server.id);
    }
}

export { statusLabel } from "./statusLabel";
