#!/usr/bin/env bash
# Nightly Postgres backup: a custom-format dump kept on the server for 7 days and copied to the
# object storage bucket (backups/, kept 14 days), so losing the server does not lose the data.
#
# Install once on the server (runs at 02:30 server time):
#   echo '30 2 * * * root /opt/the-workplace-brain/deploy/backup-db.sh >> /var/log/knowhaven-backup.log 2>&1' \
#     | sudo tee /etc/cron.d/knowhaven-backup
# Restore:
#   docker compose exec -T db pg_restore -U brain_owner -d brain --clean --if-exists < brain-<ts>.dump
set -euo pipefail

APP=/opt/the-workplace-brain
DIR=/var/backups/knowhaven
TS=$(date -u +%Y%m%dT%H%M%SZ)
FILE="$DIR/brain-$TS.dump"

cd "$APP"
mkdir -p "$DIR"
# </dev/null: `exec -T` would otherwise read this script's stdin.
docker compose exec -T db pg_dump -U brain_owner -d brain -Fc </dev/null >"$FILE"
find "$DIR" -name 'brain-*.dump' -mtime +7 -delete

docker compose exec -T -e KEY="backups/brain-$TS.dump" api python -c '
import os, sys
from datetime import UTC, datetime, timedelta
from brain import storage
from brain.config import get_settings
c, bucket = storage._client(), get_settings().storage_bucket
c.put_object(Bucket=bucket, Key=os.environ["KEY"], Body=sys.stdin.buffer.read())
cutoff = datetime.now(UTC) - timedelta(days=14)
for page in c.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix="backups/"):
    for o in page.get("Contents", []):
        if o["LastModified"] < cutoff:
            c.delete_object(Bucket=bucket, Key=o["Key"])
print("uploaded", os.environ["KEY"])
' <"$FILE"
echo "backup $FILE ($(du -h "$FILE" | cut -f1))"
