#!/bin/sh
# Vercel runs this instead of `next build`. Only production builds migrate:
# preview builds of unmerged branches must never change the live database.
set -e
if [ "$VERCEL_ENV" = "production" ] && [ -n "${DATABASE_URL_UNPOOLED:-$DATABASE_URL}" ]; then
  node scripts/migrate.mjs
else
  echo "vercel-build: ${VERCEL_ENV:-local} build; not migrating"
fi
npx next build
