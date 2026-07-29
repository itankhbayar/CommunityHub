#!/bin/sh
# The api container starts against a bind-mounted source tree, so the generated
# Prisma Client is produced here rather than baked into the image — a fresh
# clone has no src/generated/ to copy in.
#
# `migrate deploy` (not `migrate dev`) applies committed migrations only: it
# never prompts and never invents a migration, which is what a container start
# should do. Compose already gates this on the db healthcheck.
set -e

echo "[entrypoint] generating prisma client..."
npx prisma generate

echo "[entrypoint] applying migrations..."
npx prisma migrate deploy

echo "[entrypoint] starting api..."
exec npm run start:dev
