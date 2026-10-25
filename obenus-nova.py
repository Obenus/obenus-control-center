#!/usr/bin/env python3
"""Obenus NOVA universal agent. Python 3.6+, Linux with system cron."""
import argparse
import concurrent.futures
import datetime
import hashlib
import getpass
import json
import os
import re
import shutil
import socket
import ssl
import stat
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request
import urllib.error
from pathlib import Path

VERSION = '1.0.1'
TARGET = Path('/usr/local/sbin/obenus-nova.py')
CONFIG = Path('/etc/obenus-monitor/nova.json')
LEGACY_CONFIG = Path('/etc/obenus-monitor/telegram.json')
STATE = Path('/var/lib/obenus-monitor/nova-state.json')
LOG = Path('/var/log/obenus-monitor/nova.log')
CRON = Path('/etc/cron.d/obenus-nova')
HOST = socket.gethostname()


def command(argv, timeout=12):
    try:
        p = subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                           universal_newlines=True, timeout=timeout)
        return p.returncode, p.stdout
    except Exception as exc:
        return 99, type(exc).__name__


def read_json(path, default):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return default


def write_json(path, data, mode=0o600):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix='.nova-', dir=str(path.parent))
    try:
        os.fchmod(fd, mode)
        with os.fdopen(fd, 'w') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.write('\n')
        os.replace(tmp, str(path))
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def telegram(cfg, message):
    token = cfg.get('bot_token', '')
    chat = str(cfg.get('chat_id', ''))
    if not token or not chat:
        raise RuntimeError('Telegram no configurado')
    payload = urllib.parse.urlencode({'chat_id': chat, 'text': message}).encode()
    req = urllib.request.Request('https://api.telegram.org/bot{}/sendMessage'.format(token), data=payload)
    with urllib.request.urlopen(req, timeout=15) as response:
        result = json.loads(response.read().decode())
    if not result.get('ok'):
        raise RuntimeError('Telegram no confirmó el mensaje')


def validate_telegram(cfg, send_test=False):
    """Validate token with Telegram API and optionally verify chat delivery."""
    token = str(cfg.get('bot_token', '')).strip()
    chat = str(cfg.get('chat_id', '')).strip()
    if not re.match(r'^\d+:[A-Za-z0-9_-]{20,}$', token):
        raise ValueError('formato de token Telegram incorrecto')
    if not chat:
        raise ValueError('Chat ID vacío')
    try:
        with urllib.request.urlopen(
                'https://api.telegram.org/bot{}/getMe'.format(token), timeout=15) as r:
            response = json.loads(r.read().decode())
        if not response.get('ok'):
            raise ValueError('Telegram no valida el bot')
        if send_test:
            telegram(cfg, '🟢 NOVA | {}\nPrueba Telegram correcta'.format(HOST))
    except urllib.error.HTTPError as exc:
        raise ValueError('Telegram HTTP {} (verifique token y Chat ID)'.format(exc.code))
    except urllib.error.URLError:
        raise ValueError('No se puede conectar con Telegram')
    return True


def configure_telegram():
    if os.geteuid() != 0:
        raise SystemExit('ERROR: se requiere root')
    cfg = read_json(CONFIG, {})
    token = getpass.getpass('Token del bot Telegram: ').strip()
    chat = getpass.getpass('Chat ID Telegram: ').strip()
    candidate = dict(cfg, bot_token=token, chat_id=chat)
    validate_telegram(candidate, send_test=True)
    write_json(CONFIG, candidate)
    print('Telegram: VALIDADO y configuración actualizada (permisos 600)')
    return 0


def report_line(message):
    LOG.parent.mkdir(parents=True, exist_ok=True)
    with LOG.open('a') as f:
        f.write('{} {}\n'.format(datetime.datetime.now().isoformat(), message))


def check_ssl(domain, port):
    try:
        context = ssl.create_default_context()
        with socket.create_connection((domain, port), timeout=5) as sock:
            with context.wrap_socket(sock, server_hostname=domain) as conn:
                cert = conn.getpeercert()
        days = int((ssl.cert_time_to_seconds(cert['notAfter']) - time.time()) / 86400)
        return {'name': '{}:{}'.format(domain, port), 'days': days, 'error': None}
    except Exception as exc:
        return {'name': '{}:{}'.format(domain, port), 'days': None, 'error': type(exc).__name__}


def ssl_domains(cfg):
    domains = []
    for entry in cfg.get('ssl_domains', []):
        if isinstance(entry, str):
            domains.append((entry, 443))
        elif isinstance(entry, dict):
            domains.append((entry['host'], int(entry.get('port', 443))))
    if cfg.get('plesk_ssl_autodiscovery', False) and shutil.which('plesk'):
        rc, output = command(['plesk', 'bin', 'domain', '--list'], 15)
        if rc == 0:
            domains += [(x.strip(), 443) for x in output.splitlines() if x.strip() and ' ' not in x]
    return sorted(set(domains))


def checks(cfg, state, include_s3=False):
    problems = {}
    info = []
    now = time.time()
    def problem(key, message, threshold=2):
        problems[key] = {'message': message, 'threshold': threshold}

    # Host: memory and filesystem
    try:
        mem = {}
        for line in Path('/proc/meminfo').read_text().splitlines():
            k, _, v = line.partition(':')
            mem[k] = int(v.strip().split()[0])
        total, avail = mem['MemTotal'], mem['MemAvailable']
        pct = 100.0 * (total - avail) / total
        info.append('RAM {:.0f}%'.format(pct))
        if pct >= cfg.get('memory_threshold', 90):
            problem('host_ram', 'RAM utilizada {:.1f}%'.format(pct), 3)
    except (OSError, ValueError, KeyError, ZeroDivisionError):
        info.append('RAM sin datos')
    disk = shutil.disk_usage('/')
    pct = 100.0 * disk.used / disk.total
    info.append('Disco / {:.0f}%'.format(pct))
    if pct >= cfg.get('disk_threshold', 90):
        problem('disk_root', 'Disco raíz {:.1f}%'.format(pct), 2)

    # Services: only explicit services, avoid false positives on other distros
    for service in cfg.get('services', []):
        rc, output = command(['systemctl', 'is-active', service], 5)
        if rc != 0 or output.strip() != 'active':
            problem('service_' + service, 'Servicio inactivo: ' + service)

    # Docker: discovery and memory, no fixed container names
    if shutil.which('docker'):
        rc, output = command(['docker', 'ps', '-a', '--format', '{{.Names}}|{{.State}}'], 15)
        if rc == 0:
            containers = []
            for line in output.splitlines():
                if '|' not in line:
                    continue
                name, status = line.split('|', 1)
                containers.append(name)
                if status.strip() != 'running':
                    problem('docker_state_' + name, 'Docker detenido: {} ({})'.format(name, status))
            info.append('Docker {} contenedores'.format(len(containers)))
            if containers:
                rc, output = command(['docker', 'ps', '--format', '{{.Names}}|{{.Status}}'], 15)
                if rc == 0:
                    for line in output.splitlines():
                        if ' (unhealthy)' in line:
                            name = line.split('|', 1)[0]
                            problem('docker_health_' + name, 'Docker unhealthy: ' + name)
                rc, output = command(['docker', 'stats', '--no-stream', '--format', '{{.Name}}|{{.MemPerc}}'], 25)
                if rc == 0:
                    for line in output.splitlines():
                        if '|' not in line:
                            continue
                        name, raw = line.split('|', 1)
                        try:
                            pct = float(raw.strip().rstrip('%'))
                        except ValueError:
                            continue
                        if pct >= cfg.get('docker_memory_threshold', 85):
                            problem('docker_memory_' + name, 'Docker memoria {} {:.1f}%'.format(name, pct), 3)
        else:
            problem('docker_unavailable', 'No se puede consultar Docker')

    # SSL cache refreshed only every 6 hours; problems persist across minute runs
    cache = state.setdefault('ssl_cache', {})
    if now - cache.get('time', 0) >= cfg.get('ssl_interval_seconds', 21600):
        domains = ssl_domains(cfg)
        if domains:
            with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
                results = list(pool.map(lambda d: check_ssl(*d), domains))
            cache.update({'time': now, 'results': results})
        else:
            cache.update({'time': now, 'results': []})
    ssl_results = cache.get('results', [])
    for result in ssl_results:
        key = 'ssl_' + result['name']
        if result['error']:
            problem(key, 'SSL inválido {}: {}'.format(result['name'], result['error']))
        elif result['days'] < cfg.get('ssl_days_threshold', 15):
            problem(key, 'SSL caduca en {} días: {}'.format(result['days'], result['name']))
    info.append('SSL {} certificados'.format(len(ssl_results)))

    # Plesk backup: verify recent local metadata and PMM exit codes
    if Path('/var/lib/psa/dumps').is_dir():
        local = list(Path('/var/lib/psa/dumps').glob('backup_info_*.xml'))
        if not local:
            problem('plesk_backup_missing', 'Plesk: no hay metadatos de backup')
        else:
            latest = max(local, key=lambda p: p.stat().st_mtime)
            age = (now - latest.stat().st_mtime) / 3600
            info.append('Backup local {:.1f} h'.format(age))
            if age > cfg.get('backup_max_age_hours', 36):
                problem('plesk_backup_age', 'Backup Plesk antiguo: {:.1f} horas'.format(age))
        logs = list(Path('/var/log/plesk/PMM').glob('backup-*/backup.log'))
        if logs:
            latest_log = max(logs, key=lambda p: p.stat().st_mtime)
            data = latest_log.read_text(errors='replace')
            exits = [int(x) for x in re.findall(r'pmm-ras finished\. Exit code:\s*(\d+)', data)]
            errors = re.findall(r'^\[[^]]+\]\s+(?:ERROR|CRITICAL|FATAL):', data, re.MULTILINE)
            if not exits or any(x != 0 for x in exits) or errors:
                problem('plesk_backup_result', 'Errores en último backup Plesk')

    # S3: only when explicitly enabled and scheduled in 6-hour job
    if include_s3 and cfg.get('s3_enabled', False):
        repo = cfg.get('s3_repository', 'ext://s3-backup/server/')
        pmm = next((p for p in ['/usr/local/psa/admin/bin/pmm-ras', '/opt/psa/admin/bin/pmm-ras'] if Path(p).is_file()), None)
        if not pmm:
            problem('s3_tool', 'S3: no se encuentra pmm-ras', 1)
        else:
            rc, _ = command([pmm, '--check-repository', '--dump-storage=' + repo], 90)
            if rc != 0:
                problem('s3_repository', 'S3: repositorio inaccesible (código {})'.format(rc), 1)
            rc, output = command([pmm, '--get-ftp-dump-list', '--dump-storage=' + repo, '--type=server', '--not-use-cache'], 120)
            if rc != 0:
                problem('s3_listing', 'S3: listado fallido (código {})'.format(rc), 1)
            else:
                remote = set(re.findall(r'backup_info_\d+(?:_\d+)?\.xml', output))
                local = list(Path('/var/lib/psa/dumps').glob('backup_info_*.xml'))
                if local:
                    latest = max(local, key=lambda p: p.stat().st_mtime)
                    grace = cfg.get('s3_upload_grace_seconds', 7200)
                    if time.time() - latest.stat().st_mtime > grace and latest.name not in remote:
                        problem('s3_latest', 'S3: última copia local no encontrada', 1)
                if not remote:
                    problem('s3_empty', 'S3: no se identifican copias', 1)
                info.append('S3 {} copias'.format(len(remote)))
    return problems, info


def run_monitor(include_s3=False):
    cfg = read_json(CONFIG, {})
    state = read_json(STATE, {})
    problems, info = checks(cfg, state, include_s3)
    # Process only this job's alert scope; S3 must not affect minute counters.
    problems = {k: v for k, v in problems.items() if k.startswith('s3_') == bool(include_s3)}
    # Separate alert scopes: the minute job never recovers S3 alerts it has not checked.
    previous = state.setdefault('alerts', {})
    keys = set(problems)
    for key, item in list(previous.items()):
        if key.startswith('s3_') != bool(include_s3):
            continue
        if key not in keys:
            if item.get('notified'):
                try:
                    telegram(cfg, '🟢 NOVA | {}\nRECUPERADO: {}'.format(HOST, item['message']))
                    report_line('RECUPERACION ' + key)
                except Exception as exc:
                    report_line('ERROR TELEGRAM recuperación {}: {}'.format(key, type(exc).__name__))
                    continue
            previous.pop(key, None)
    for key, data in problems.items():
        old = previous.get(key, {})
        item = {'message': data['message'], 'count': old.get('count', 0) + 1,
                'notified': old.get('notified', False)}
        if not item['notified'] and item['count'] >= data['threshold']:
            try:
                telegram(cfg, '🔴 NOVA | {}\nALERTA: {}'.format(HOST, item['message']))
                item['notified'] = True
                report_line('ALERTA ' + key)
            except Exception as exc:
                report_line('ERROR TELEGRAM alerta {}: {}'.format(key, type(exc).__name__))
        previous[key] = item
    today = datetime.date.today().isoformat()
    if not include_s3 and datetime.datetime.now().hour >= cfg.get('report_hour', 9) and state.get('report_day') != today:
        msg = '📊 NOVA | {}\nInforme {}\n{}\nAlertas activas: {}'.format(
            HOST, today, ' | '.join(info), sum(1 for x in previous.values() if x.get('notified')))
        try:
            telegram(cfg, msg)
            state['report_day'] = today
            report_line('INFORME DIARIO')
        except Exception as exc:
            report_line('ERROR TELEGRAM informe: ' + type(exc).__name__)
    state['agent_version'] = VERSION
    state['last_run_s3' if include_s3 else 'last_run'] = datetime.datetime.now().isoformat()
    write_json(STATE, state)
    print('NOVA {} | {} | problemas {}'.format(HOST, 'S3' if include_s3 else 'general', len(problems)))
    return 0


def install(args):
    if os.geteuid() != 0:
        raise SystemExit('ERROR: instalación requiere root')
    source = Path(__file__).resolve()
    if not source.is_file():
        raise SystemExit('ERROR: instalador no es un archivo local')
    current_cfg = read_json(CONFIG, {})
    if not current_cfg and LEGACY_CONFIG.exists():
        legacy = read_json(LEGACY_CONFIG, {})
        current_cfg = {k: legacy[k] for k in ('bot_token', 'chat_id') if k in legacy}
    supplied_token = os.environ.get('NOVA_TELEGRAM_TOKEN')
    supplied_chat = os.environ.get('NOVA_TELEGRAM_CHAT_ID')
    if supplied_token is not None or supplied_chat is not None:
        candidate = dict(current_cfg)
        if supplied_token is not None:
            candidate['bot_token'] = supplied_token.strip()
        if supplied_chat is not None:
            candidate['chat_id'] = supplied_chat.strip()
        try:
            validate_telegram(candidate, send_test=False)
        except ValueError as exc:
            raise SystemExit('ERROR: credenciales Telegram nuevas rechazadas: {}'.format(exc))
    else:
        candidate = current_cfg
    # Installation/update remains possible without credentials, but warns clearly.
    new_data = source.read_bytes()
    new_hash = hashlib.sha256(new_data).hexdigest()
    old_hash = hashlib.sha256(TARGET.read_bytes()).hexdigest() if TARGET.exists() else None
    print('Versión: {} | SHA256: {}'.format(VERSION, new_hash[:16]))
    if old_hash == new_hash:
        print('Agente: SIN CAMBIOS (SHA256 idéntico)')
    else:
        TARGET.parent.mkdir(parents=True, exist_ok=True)
        if TARGET.exists():
            stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
            backup = TARGET.with_name(TARGET.name + '.bak-' + stamp)
            shutil.copy2(str(TARGET), str(backup))
            print('Copia anterior:', backup)
        fd, tmp = tempfile.mkstemp(prefix='.nova-', dir=str(TARGET.parent))
        try:
            os.fchmod(fd, 0o700)
            with os.fdopen(fd, 'wb') as f:
                f.write(new_data)
            rc, output = command([sys.executable, '-m', 'py_compile', tmp], 15)
            if rc != 0:
                raise RuntimeError('Error de sintaxis: ' + output[:200])
            os.replace(tmp, str(TARGET))
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)
        print('Agente:', 'ACTUALIZADO' if old_hash else 'INSTALADO')
    cfg = candidate
    defaults = {'services': [], 'ssl_domains': [], 'plesk_ssl_autodiscovery': False,
                's3_enabled': False, 's3_repository': 'ext://s3-backup/server/',
                'report_hour': 9, 'ssl_interval_seconds': 21600,
                's3_upload_grace_seconds': 7200}
    for key, value in defaults.items():
        cfg.setdefault(key, value)
    if args.plesk_ssl or (not CONFIG.exists() and shutil.which('plesk')):
        cfg['plesk_ssl_autodiscovery'] = True
    if args.s3 or (not CONFIG.exists() and shutil.which('plesk') and
                   's3-backup' in command(['plesk', 'bin', 'extension', '--list'], 15)[1]):
        cfg['s3_enabled'] = True
    write_json(CONFIG, cfg)
    cron_text = ('SHELL=/bin/sh\n'
                 'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\n'
                 '* * * * * root /usr/bin/flock -n /run/obenus-nova.lock /usr/bin/python3 {} --run >> {} 2>&1\n'
                 '17 2,8,14,20 * * * root /usr/bin/flock -n /run/obenus-nova-s3.lock /usr/bin/python3 {} --s3-run >> {} 2>&1\n').format(TARGET, LOG, TARGET, LOG)
    if not CRON.exists() or CRON.read_text() != cron_text:
        CRON.write_text(cron_text)
    os.chmod(str(CRON), 0o644)
    print('Cron: instalado | Configuración: {}'.format(CONFIG))
    try:
        validate_telegram(cfg)
        print('Telegram: token VALIDADO')
    except ValueError as exc:
        print('AVISO: Telegram NO VALIDADO: {}'.format(exc))
        print('Ejecute: python3 {} --configure-telegram'.format(TARGET))
    legacy_crons = [str(p) for p in (Path('/etc/cron.d/obenus-alertas'), Path('/etc/cron.d/obenus-monitor'), Path('/etc/cron.d/nova-s3-monitor')) if p.exists()]
    if legacy_crons:
        print('AVISO: existen monitores anteriores; no se desactivan automáticamente:')
        for path in legacy_crons:
            print('  ' + path)
        print('Evitar alertas duplicadas antes de poner NOVA en producción.')
    return 0


def diagnose():
    cfg = read_json(CONFIG, {})
    state = read_json(STATE, {})
    print('NOVA {} | versión {}'.format(HOST, VERSION))
    print('Instalado: {} | Cron: {}'.format(TARGET.exists(), CRON.exists()))
    print('Docker: {} | Plesk: {}'.format(bool(shutil.which('docker')), bool(shutil.which('plesk'))))
    print('SSL autodiscovery: {} | S3 habilitado: {}'.format(
        bool(cfg.get('plesk_ssl_autodiscovery')), bool(cfg.get('s3_enabled'))))
    print('Última ejecución: {} | Último S3: {}'.format(
        state.get('last_run', 'nunca'), state.get('last_run_s3', 'nunca')))
    print('Alertas notificadas: {}'.format(sum(
        1 for x in state.get('alerts', {}).values() if x.get('notified'))))
    try:
        validate_telegram(cfg)
        print('Telegram: VALIDADO')
    except ValueError as exc:
        print('Telegram: ERROR ({})'.format(exc))
    return 0


def main():
    parser = argparse.ArgumentParser(description='Obenus NOVA universal: instalación idempotente y monitorización')
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--install', action='store_true')
    group.add_argument('--run', action='store_true')
    group.add_argument('--s3-run', action='store_true')
    group.add_argument('--status', action='store_true')
    group.add_argument('--test-telegram', action='store_true')
    group.add_argument('--configure-telegram', action='store_true')
    group.add_argument('--diagnose', action='store_true')
    parser.add_argument('--plesk-ssl', action='store_true', help='Activar descubrimiento SSL de Plesk')
    parser.add_argument('--s3', action='store_true', help='Activar monitor S3 de Plesk')
    args = parser.parse_args()
    if args.install:
        return install(args)
    if args.configure_telegram:
        return configure_telegram()
    if args.diagnose:
        return diagnose()
    if args.status:
        state = read_json(STATE, {})
        cfg = read_json(CONFIG, {})
        print('NOVA {} | versión {} | configurado {} | último {} | S3 {} | alertas {}'.format(
            HOST, VERSION, bool(cfg.get('bot_token') and cfg.get('chat_id')),
            state.get('last_run', 'nunca'), state.get('last_run_s3', 'nunca'),
            sum(1 for x in state.get('alerts', {}).values() if x.get('notified'))))
        return 0
    if args.test_telegram:
        validate_telegram(read_json(CONFIG, {}), send_test=True)
        print('Telegram: OK')
        return 0
    return run_monitor(include_s3=args.s3_run)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as exc:
        report_line('ERROR GENERAL: ' + type(exc).__name__ + ': ' + str(exc)[:180])
        print('ERROR: {}: {}'.format(type(exc).__name__, str(exc)[:180]), file=sys.stderr)
        sys.exit(1)
