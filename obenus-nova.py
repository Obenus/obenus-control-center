#!/usr/bin/env python3
"""Obenus NOVA universal agent. Python 3.6+, Linux with system cron."""
import argparse
import concurrent.futures
import datetime
import hashlib
import getpass
import html
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

VERSION = '1.0.5'
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


def telegram(cfg, message, html_mode=False):
    token = cfg.get('bot_token', '')
    chat = str(cfg.get('chat_id', ''))
    if not token or not chat:
        raise RuntimeError('Telegram no configurado')
    payload_data = {'chat_id': chat, 'text': message}
    if html_mode:
        payload_data['parse_mode'] = 'HTML'
    payload = urllib.parse.urlencode(payload_data).encode()
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
        rc, output = command([
            'plesk', 'db', '-Ne',
            "SELECT name FROM domains WHERE htype = 'vrt_hst'"
        ], 15)
        if rc == 0:
            domains += [(x.strip(), 443) for x in output.splitlines()
                        if x.strip() and ' ' not in x]
        else:
            report_line('ERROR SSL descubrimiento Plesk: ' + output[:180])
    return sorted(set(domains))




def advanced_host_checks(cfg, state, problem):
    """Linux host checks with independent state and debounced notifications."""
    details = {}
    try:
        values = {}
        for line in Path('/proc/meminfo').read_text().splitlines():
            k, _, v = line.partition(':')
            values[k] = int(v.strip().split()[0])
        available = values['MemAvailable'] / 1024.0
        swap_total = values.get('SwapTotal', 0)
        swap_pct = 100.0 * (swap_total - values.get('SwapFree', 0)) / swap_total if swap_total else 0.0
        details['ram_available_mb'] = round(available)
        details['swap_pct'] = round(swap_pct, 1)
        if available < 500:
            problem('host_ram_available_critical', 'RAM disponible crítica: {:.0f} MB'.format(available), 1)
        elif available < 1024:
            problem('host_ram_available_low', 'RAM disponible baja: {:.0f} MB'.format(available), 3)
    except (OSError, KeyError, ValueError, ZeroDivisionError):
        pass
    try:
        loads = os.getloadavg()
        details['load'] = [round(x, 2) for x in loads]
        if loads[1] > cfg.get('load5_threshold', 8):
            problem('host_load', 'Carga a 5 minutos elevada: {:.2f}'.format(loads[1]), 2)
    except OSError:
        pass
    try:
        blocked = 0
        for pid in os.listdir('/proc'):
            if not pid.isdigit():
                continue
            try:
                stat_line = Path('/proc/{}/stat'.format(pid)).read_text()
                if stat_line[stat_line.rfind(')') + 2:].split()[0] == 'D':
                    blocked += 1
            except (OSError, IndexError):
                pass
        details['blocked'] = blocked
        if blocked >= cfg.get('blocked_threshold', 10):
            problem('host_blocked', '{} procesos bloqueados (estado D)'.format(blocked), 2)
    except OSError:
        pass
    try:
        cpu = [int(x) for x in Path('/proc/stat').read_text().splitlines()[0].split()[1:]]
        current = {'total': sum(cpu), 'wait': cpu[4]}
        previous = state.get('advanced_cpu', {})
        state['advanced_cpu'] = current
        delta = current['total'] - previous.get('total', current['total'])
        wait = current['wait'] - previous.get('wait', current['wait'])
        if delta > 0 and wait >= 0:
            pct = 100.0 * wait / delta
            details['iowait_pct'] = round(pct, 1)
            if pct > cfg.get('iowait_threshold', 20):
                problem('host_iowait', 'I/O wait elevado: {:.1f}%'.format(pct), 3)
    except (OSError, ValueError, IndexError):
        pass
    try:
        swap = {}
        for line in Path('/proc/vmstat').read_text().splitlines():
            parts = line.split()
            if parts[0] in ('pswpin', 'pswpout'):
                swap[parts[0]] = int(parts[1])
        previous = state.get('advanced_swap', {})
        state['advanced_swap'] = swap
        if previous:
            delta = sum(max(0, swap.get(k, 0) - previous.get(k, swap.get(k, 0))) for k in ('pswpin', 'pswpout'))
            details['swap_pages'] = delta
            available = details.get('ram_available_mb', 999999)
            pct = details.get('swap_pct', 0)
            critical = (pct >= 98 and available < 750) or (available < 500 and delta >= 1024)
            pressure = pct >= 85 and available < 1500 and delta >= 1024
            cooldown = state.get('swap_cooldown_until', 0) > time.time()
            if critical:
                problem('host_swap_pressure', 'Presión crítica de memoria: RAM {} MB, swap {}%, {} páginas'.format(available, pct, delta), 1)
            elif pressure and not cooldown:
                problem('host_swap_pressure', 'Presión de memoria: RAM {} MB, swap {}%, {} páginas'.format(available, pct, delta), 3)
    except (OSError, ValueError, IndexError):
        pass
    try:
        history = state.setdefault('advanced_process_history', {})
        now = time.time()
        active = set()
        count = 0
        heavy = []
        for pid in os.listdir('/proc'):
            if not pid.isdigit():
                continue
            try:
                status = Path('/proc/{}/status'.format(pid)).read_text()
                match = re.search(r'^VmRSS:\s*(\d+)\s+kB', status, re.MULTILINE)
                if not match:
                    continue
                rss = int(match.group(1)) / 1024.0
                name_match = re.search(r'^Name:\s*(.+)$', status, re.MULTILINE)
                name = name_match.group(1).strip() if name_match else pid
                stat_line = Path('/proc/{}/stat'.format(pid)).read_text()
                start = stat_line[stat_line.rfind(')') + 2:].split()[19]
                key = '{}:{}'.format(pid, start)
                active.add(key)
                count += 1
                if rss >= 250:
                    heavy.append((rss, name, pid))
                old = history.get(key, [])
                old = [x for x in old if isinstance(x, list) and len(x) == 2 and now - x[0] <= 390]
                oldest = next((x for x in old if now - x[0] >= 225), None)
                growth = rss - oldest[1] if oldest else 0
                if rss >= cfg.get('process_critical_mb', 2500):
                    problem('process_' + key, 'Proceso {} (PID {}) crítico: {:.0f} MB'.format(name, pid, rss), 1)
                elif growth >= cfg.get('process_growth_mb', 500):
                    problem('process_' + key, 'Proceso {} (PID {}) creció {:.0f} MB en 5 min'.format(name, pid, growth), 1)
                elif rss >= cfg.get('process_high_mb', 1500):
                    problem('process_' + key, 'Proceso {} (PID {}) consume {:.0f} MB'.format(name, pid, rss), 3)
                old.append([now, rss])
                history[key] = old[-8:]
            except (OSError, IndexError, ValueError):
                pass
        for key in list(history):
            if key not in active:
                del history[key]
        details['processes'] = count
        details['top_processes'] = [{'name': n, 'pid': pid, 'mb': round(r)} for r, n, pid in sorted(heavy, reverse=True)[:3]]
    except OSError:
        pass
    state['advanced_details'] = details



# Presentation only: debounce thresholds remain independent of severity.
SEVERITY_ICONS = ('🟢', '🟡', '🔴', '🚨')
SEVERITY_LABELS = ('CORRECTO', 'ADVERTENCIA', 'ERROR', 'CRÍTICO')


def escape_html(value):
    return html.escape(str(value), quote=False)


def format_review_date(value):
    """Format saved ISO timestamp for display, without changing its timezone."""
    raw = str(value)
    for pattern in ('%Y-%m-%dT%H:%M:%S.%f', '%Y-%m-%dT%H:%M:%S'):
        try:
            return datetime.datetime.strptime(raw, pattern).strftime('%d/%m/%Y %H:%M:%S')
        except ValueError:
            pass
    return raw


def problem_severity(key, message):
    if key == 'host_ram_available_critical':
        return 3
    if key == 'host_swap_pressure':
        return 3 if 'crítica' in message.lower() else 1
    if key.startswith('process_'):
        return 3 if 'crítico:' in message.lower() else 1
    if key.startswith('ssl_'):
        if message.startswith('SSL inválido'):
            return 2
        match = re.search(r'caduca en (-?\d+) días', message)
        return 2 if match and int(match.group(1)) <= 0 else 1
    if key.startswith(('service_', 'docker_state_', 'docker_health_', 's3_')):
        return 2
    if key in ('docker_unavailable', 'plesk_backup_missing',
               'plesk_backup_age', 'plesk_backup_result'):
        return 2
    return 1


def event_message(key, message, recovered=False):
    severity = 0 if recovered else problem_severity(key, message)
    title = 'RECUPERADO' if recovered else SEVERITY_LABELS[severity]
    return '{} <b>NOVA | {}</b>\n<b>{}</b>\n{}'.format(
        SEVERITY_ICONS[severity], escape_html(HOST), title,
        escape_html(message))


def detailed_report(cfg, state, problems):
    """HTML-escaped Telegram report, avoiding Markdown parsing issues."""
    d = state.get('advanced_details', {})
    info = state.get('report_details', {})
    esc = escape_html
    active = {k: v for k, v in state.get('alerts', {}).items()
              if v.get('notified')}
    active.update(problems)
    overall = max([problem_severity(k, v.get('message', ''))
                   for k, v in active.items()] or [0])
    row_keys = {
        'RAM utilizada': ('host_ram',),
        'RAM disponible': ('host_ram_available_',),
        'Swap': ('host_swap_pressure',),
        'Actividad swap': ('host_swap_pressure',),
        'Carga 1/5/15 min': ('host_load',),
        'Procesos bloqueados': ('host_blocked',),
        'I/O wait': ('host_iowait',),
        'Procesos vigilados': ('process_',),
        'Procesos con más RAM': ('process_',),
        'Disco /': ('disk_root',),
        'Backup Plesk': ('plesk_backup_missing', 'plesk_backup_age'),
        'PMM': ('plesk_backup_result',),
        'S3': ('s3_',),
        'Certificados': ('ssl_',),
        'Contenedores': ('docker_state_', 'docker_unavailable'),
        'Memoria elevada': ('docker_memory_',),
        'Healthchecks': ('docker_health_',)}
    now = datetime.datetime.now()
    lines = ['{} <b>NOVA | INFORME DIARIO — {}</b>'.format(
                 SEVERITY_ICONS[overall], SEVERITY_LABELS[overall]),
             '🖥 <b>Servidor:</b> ' + esc(HOST),
             '🗓 <b>Fecha:</b> ' + now.strftime('%d/%m/%Y %H:%M'),
             '', '🧠 <b>MEMORIA Y SISTEMA</b>']
    def item(label, value):
        levels = [problem_severity(k, v.get('message', ''))
                  for k, v in active.items()
                  if any(k.startswith(prefix) for prefix in row_keys.get(label, ()))]
        unavailable = str(value) in ('Sin datos', 'No disponible', 'No instalado')
        level = max(levels or [1 if unavailable else 0])
        # A saved review date is informational, not a health verdict.
        # Real S3 incidents above retain their error severity.
        if label == 'S3' and not levels:
            lines.append('ℹ️ <b>S3:</b> ' + esc(value))
            return
        text = esc(value)
        if level:
            text = '<b>' + text + '</b>'
        lines.append('{} <b>{}:</b> {}'.format(SEVERITY_ICONS[level], esc(label), text))
    item('RAM utilizada', info.get('ram', 'Sin datos'))
    item('RAM disponible', '{} MB'.format(d['ram_available_mb']) if 'ram_available_mb' in d else 'Sin datos')
    item('Swap', '{}%'.format(d['swap_pct']) if 'swap_pct' in d else 'Sin datos')
    item('Actividad swap', '{} páginas desde última lectura'.format(d['swap_pages']) if 'swap_pages' in d else 'Sin datos')
    item('Carga 1/5/15 min', ' / '.join(map(str, d['load'])) if 'load' in d else 'Sin datos')
    item('Procesos bloqueados', d.get('blocked', 'Sin datos'))
    item('I/O wait', '{}%'.format(d['iowait_pct']) if 'iowait_pct' in d else 'Sin datos')
    item('Procesos vigilados', d.get('processes', 'Sin datos'))
    if d.get('top_processes'):
        item('Procesos con más RAM', ', '.join('{} {} MB'.format(x['name'], x['mb']) for x in d['top_processes']))
    lines.extend(['', '💽 <b>ALMACENAMIENTO Y BACKUPS</b>'])
    item('Disco /', info.get('disk', 'Sin datos'))
    item('Backup Plesk', info.get('backup', 'No disponible'))
    item('PMM', info.get('pmm', 'Sin datos'))
    if cfg.get('s3_enabled'):
        item('S3', 'Última revisión: ' + format_review_date(state.get('last_run_s3', 'Sin datos')))
    lines.extend(['', '🔐 <b>SEGURIDAD SSL</b>'])
    item('Certificados', info.get('ssl', 'Sin datos'))
    lines.extend(['', '🐳 <b>DOCKER</b>'])
    item('Contenedores', info.get('docker', 'No instalado'))
    item('Memoria elevada', info.get('docker_memory', 'Sin datos'))
    item('Healthchecks', info.get('docker_health', 'Sin datos'))
    lines.extend(['', '<b>INCIDENCIAS</b>'])
    notified = sum(1 for v in state.get('alerts', {}).values() if v.get('notified'))
    lines.append('Alertas notificadas activas: {}'.format(notified))
    if active:
        for key, data in sorted(active.items(), key=lambda pair: (
                -problem_severity(pair[0], pair[1].get('message', '')), pair[0])):
            message = data.get('message', '')
            severity = problem_severity(key, message)
            lines.append('{} <b>{}: {}</b>'.format(
                SEVERITY_ICONS[severity], SEVERITY_LABELS[severity], esc(message)))
    else:
        lines.append('🟢 Sin incidencias detectadas en los datos disponibles')
    return '\n'.join(lines)


def checks(cfg, state, include_s3=False):
    problems = {}
    info = []
    now = time.time()
    def problem(key, message, threshold=2):
        problems[key] = {'message': message, 'threshold': threshold}

    details = {}
    # Host: memory and filesystem
    try:
        mem = {}
        for line in Path('/proc/meminfo').read_text().splitlines():
            k, _, v = line.partition(':')
            mem[k] = int(v.strip().split()[0])
        total, avail = mem['MemTotal'], mem['MemAvailable']
        pct = 100.0 * (total - avail) / total
        info.append('RAM {:.0f}%'.format(pct))
        details['ram'] = '{:.1f}%'.format(pct)
        if pct >= cfg.get('memory_threshold', 90):
            problem('host_ram', 'RAM utilizada {:.1f}%'.format(pct), 3)
    except (OSError, ValueError, KeyError, ZeroDivisionError):
        info.append('RAM sin datos')
    disk = shutil.disk_usage('/')
    pct = 100.0 * disk.used / disk.total
    info.append('Disco / {:.0f}%'.format(pct))
    details['disk'] = '{:.1f}%'.format(pct)
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
            details['docker'] = '{} detectados'.format(len(containers))
            if containers:
                rc, output = command(['docker', 'ps', '--format', '{{.Names}}|{{.Status}}'], 15)
                if rc == 0:
                    healthy = sum(' (healthy)' in x for x in output.splitlines())
                    unhealthy = sum(' (unhealthy)' in x for x in output.splitlines())
                    details['docker_health'] = '{} correctos / {} unhealthy'.format(healthy, unhealthy)
                    for line in output.splitlines():
                        if ' (unhealthy)' in line:
                            name = line.split('|', 1)[0]
                            problem('docker_health_' + name, 'Docker unhealthy: ' + name)
                rc, output = command(['docker', 'stats', '--no-stream', '--format', '{{.Name}}|{{.MemPerc}}'], 25)
                if rc == 0:
                    checked = 0
                    elevated = 0
                    for line in output.splitlines():
                        if '|' not in line:
                            continue
                        name, raw = line.split('|', 1)
                        try:
                            pct = float(raw.strip().rstrip('%'))
                        except ValueError:
                            continue
                        checked += 1
                        if pct >= cfg.get('docker_memory_threshold', 85):
                            elevated += 1
                            problem('docker_memory_' + name, 'Docker memoria {} {:.1f}%'.format(name, pct), 3)
                    details['docker_memory'] = '{} revisados / {} elevados'.format(checked, elevated)
        else:
            problem('docker_unavailable', 'No se puede consultar Docker')

    # SSL cache refreshed only every 6 hours; problems persist across minute runs
    cache = state.setdefault('ssl_cache', {})
    if state.get('ssl_cache_version') != VERSION:
        cache.clear()
        state['ssl_cache_version'] = VERSION
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
    ssl_errors = sum(bool(x.get('error')) or (x.get('days') is not None and x['days'] < cfg.get('ssl_days_threshold', 15)) for x in ssl_results)
    details['ssl'] = '{} correctos / {} alertas ({} comprobados)'.format(len(ssl_results) - ssl_errors, ssl_errors, len(ssl_results))

    # Plesk backup: verify recent local metadata and PMM exit codes
    if Path('/var/lib/psa/dumps').is_dir():
        local = list(Path('/var/lib/psa/dumps').glob('backup_info_*.xml'))
        if not local:
            problem('plesk_backup_missing', 'Plesk: no hay metadatos de backup')
        else:
            latest = max(local, key=lambda p: p.stat().st_mtime)
            age = (now - latest.stat().st_mtime) / 3600
            info.append('Backup local {:.1f} h'.format(age))
            details['backup'] = 'Última copia hace {:.1f} horas'.format(age)
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
                details['pmm'] = 'Errores detectados'
            else:
                details['pmm'] = 'Correcto'

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
    if not include_s3:
        advanced_host_checks(cfg, state, problem)
        state['report_details'] = details
    return problems, info


def run_monitor(include_s3=False):
    cfg = read_json(CONFIG, {})
    state = read_json(STATE, {})
    problems, info = checks(cfg, state, include_s3)
    if not include_s3:
        try:
            boot_id = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
            previous_boot = state.get('boot_id')
            if previous_boot and previous_boot != boot_id:
                telegram(cfg, event_message('host_reboot', 'Reinicio detectado: {}'.format(datetime.datetime.now().strftime('%d/%m/%Y %H:%M'))), html_mode=True)
                report_line('REINICIO NOTIFICADO')
            state['boot_id'] = boot_id
        except Exception as exc:
            report_line('AVISO reinicio: ' + type(exc).__name__)

    # Process only this job's alert scope; S3 must not affect minute counters.
    problems = {k: v for k, v in problems.items() if k.startswith('s3_') == bool(include_s3)}
    # Separate alert scopes: the minute job never recovers S3 alerts it has not checked.
    previous = state.setdefault('alerts', {})
    keys = set(problems)
    for key, item in list(previous.items()):
        if key.startswith('s3_') != bool(include_s3):
            continue
        if key not in keys:
            item['normal'] = item.get('normal', 0) + 1
            required = 5 if key == 'host_swap_pressure' else 3 if key.startswith('process_') else 2
            if item['normal'] < required:
                continue
            if item.get('notified'):
                try:
                    telegram(cfg, event_message(key, item['message'], recovered=True), html_mode=True)
                    report_line('RECUPERACION ' + key)
                    if key == 'host_swap_pressure':
                        state['swap_cooldown_until'] = time.time() + 900
                except Exception as exc:
                    report_line('ERROR TELEGRAM recuperación {}: {}'.format(key, type(exc).__name__))
                    continue
            previous.pop(key, None)
    for key, data in problems.items():
        old = previous.get(key, {})
        item = {'message': data['message'], 'count': old.get('count', 0) + 1,
                'notified': old.get('notified', False), 'normal': 0}
        if key == 'host_swap_pressure' and 'crítica' in data['message'].lower() and 'crítica' not in old.get('message', '').lower():
            item['notified'] = False
            item['count'] = data['threshold']
        if not item['notified'] and item['count'] >= data['threshold']:
            try:
                telegram(cfg, event_message(key, item['message']), html_mode=True)
                item['notified'] = True
                report_line('ALERTA ' + key)
            except Exception as exc:
                report_line('ERROR TELEGRAM alerta {}: {}'.format(key, type(exc).__name__))
        previous[key] = item
    today = datetime.date.today().isoformat()
    if not include_s3 and datetime.datetime.now().hour >= cfg.get('report_hour', 9) and state.get('report_day') != today:
        msg = detailed_report(cfg, state, problems)
        try:
            telegram(cfg, msg, html_mode=True)
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
    LOG.parent.mkdir(parents=True, exist_ok=True)
    STATE.parent.mkdir(parents=True, exist_ok=True)
    cron_text = (
        'SHELL=/bin/sh\n'
        'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\n'
        '* * * * * root mkdir -p {logdir} {statedir} && '
        '/usr/bin/flock -n /run/obenus-nova.lock /usr/bin/python3 {agent} --run >> {log} 2>&1\n'
        '17 2,8,14,20 * * * root mkdir -p {logdir} {statedir} && '
        '/usr/bin/flock -n /run/obenus-nova-s3.lock /usr/bin/python3 {agent} --s3-run >> {log} 2>&1\n'
    ).format(logdir=LOG.parent, statedir=STATE.parent, agent=TARGET, log=LOG)
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
    # cronie (Alma/RHEL) puede ejecutar ficheros con ".disabled"; sacar legacy de cron.d.
    legacy_dir = Path('/etc/obenus-monitor/legacy-cron')
    legacy_dir.mkdir(parents=True, exist_ok=True)
    moved = []
    for pattern in ('obenus-alertas*', 'obenus-monitor*', 'nova-s3-monitor*'):
        for path in Path('/etc/cron.d').glob(pattern):
            if path.name == 'obenus-nova':
                continue
            dest = legacy_dir / path.name
            try:
                shutil.move(str(path), str(dest))
                moved.append(str(path))
            except OSError:
                pass
    for script in (
        Path('/usr/local/sbin/obenus-alertas.py'),
        Path('/usr/local/sbin/obenus-monitor.sh'),
        Path('/usr/local/sbin/nova-s3-monitor.py'),
    ):
        if script.exists() and not Path(str(script) + '.disabled-by-nova').exists():
            try:
                script.rename(Path(str(script) + '.disabled-by-nova'))
                moved.append(str(script))
            except OSError:
                pass
    if moved:
        print('Legacy desactivado (movido fuera de cron.d / renombrado):')
        for path in moved:
            print('  ' + path)
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
    group.add_argument('--preview-report', action='store_true', help='Previsualizar informe sin enviar ni alterar el estado')
    parser.add_argument('--plesk-ssl', action='store_true', help='Activar descubrimiento SSL de Plesk')
    parser.add_argument('--s3', action='store_true', help='Activar monitor S3 de Plesk')
    args = parser.parse_args()
    if args.install:
        return install(args)
    if args.configure_telegram:
        return configure_telegram()
    if args.diagnose:
        return diagnose()
    if args.preview_report:
        cfg = read_json(CONFIG, {})
        state = read_json(STATE, {})
        print(detailed_report(cfg, state, {}))
        return 0
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
