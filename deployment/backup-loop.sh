#!/bin/sh
# Dump diario de Postgres al volumen ./backups (retención configurable).
set -eu
RETENTION="${BACKUP_RETENTION_DAYS:-14}"
HOST="${POSTGRES_HOST:-postgres}"
USER="${POSTGRES_USER:-obenus}"
DB="${POSTGRES_DB:-obenus_db}"

mkdir -p /backups
echo "[backup] started retention=${RETENTION}d db=${DB}"

while true; do
  STAMP=$(date -u +%Y%m%dT%H%M%SZ)
  OUT="/backups/obenus_db_${STAMP}.sql.gz"
  if pg_dump -h "$HOST" -U "$USER" -d "$DB" --no-owner --no-acl | gzip -c > "$OUT.tmp"; then
    mv "$OUT.tmp" "$OUT"
    echo "[backup] ok $OUT"
  else
    rm -f "$OUT.tmp"
    echo "[backup] FAILED at $STAMP" >&2
  fi
  # Purga
  find /backups -type f -name 'obenus_db_*.sql.gz' -mtime +"$RETENTION" -delete 2>/dev/null || true
  # Espera ~24h
  sleep 86400
done
