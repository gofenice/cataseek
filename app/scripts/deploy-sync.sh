#!/usr/bin/env bash
#
# Sync this checkout's app/ source to the Cloudways docroot, then rebuild.
#
# WHY THIS EXISTS
# ---------------
# Deploys here are an rsync into ~/public_html/app because Cloudways owns
# ~/git_repo as root and only its dashboard "Pull" can update it. rsync --delete
# is needed so files removed in git also disappear from the server — but the
# docroot ALSO holds runtime state that has never been in git, and --delete
# happily removes anything not in the source tree.
#
# On 2026-08-19 a hand-run rsync deleted the Meilisearch binary and its data.ms
# index directory, both of which live inside app/. Meilisearch crash-looped
# (PM2 restart counter reached 17) until they were restored by hand.
#
# EVERY path that lives in the docroot but not in git must be listed below.
# The list mirrors the "managed outside git" entries in app/.gitignore — if you
# add one there, add it here too.

set -euo pipefail

REMOTE="${1:?usage: deploy-sync.sh <user@host> [remote-app-path]}"
APP_PATH="${2:-/home/1469939.cloudwaysapps.com/fztjmjnpcj/public_html/app}"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

EXCLUDES=(
  # build output and dependencies — rebuilt on the server
  --exclude 'node_modules'      --exclude 'dashboard/node_modules'
  --exclude 'dist'              --exclude 'dashboard/dist'
  # runtime state that has never been in git — deleting these breaks production
  --exclude '.env'
  --exclude 'data.ms'           --exclude 'data.ms/'
  --exclude 'meilisearch'       --exclude 'meilisearch.exe'
  --exclude 'uploads'           --exclude 'logs'
  # rollback copies taken by previous deploys
  --exclude '*.bak-*'
)

echo "==> syncing $SRC/ -> $REMOTE:$APP_PATH/"
rsync -rlpt --delete "${EXCLUDES[@]}" "$SRC/" "$REMOTE:$APP_PATH/"

echo "==> verifying runtime state survived"
ssh "$REMOTE" "cd '$APP_PATH' && for p in .env data.ms meilisearch; do
  [ -e \"\$p\" ] && echo \"    ok      \$p\" || echo \"    MISSING \$p\"
done"

echo
echo "Next, on the server:"
echo "  cd $APP_PATH && npm run build"
echo "  cd $APP_PATH/dashboard && npm run build"
echo "  pm2 restart cataseek --update-env    # needs the master user"
