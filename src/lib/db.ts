/**
 * One Postgres pool per server instance. DATABASE_URL is the pooled URL on
 * Vercel; migrations use DATABASE_URL_UNPOOLED when set.
 */
import postgres from "postgres";

declare global {
  // Reused across hot reloads in development.
  var billingSql: postgres.Sql | undefined;
}

export function db(): postgres.Sql {
  if (!globalThis.billingSql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    globalThis.billingSql = postgres(url, { max: 5, prepare: false });
  }
  return globalThis.billingSql;
}

export type Tx = postgres.TransactionSql;
