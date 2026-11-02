// Registers an app that may issue invoices and prints its API key ONCE.
// Only the key's SHA-256 is stored; a lost key is replaced with --rotate.
//
//   node --env-file=.env.local scripts/add-app.mjs geological-assistant "Geological Assistant Prep"
//   node --env-file=.env.local scripts/add-app.mjs geological-assistant --rotate
//
// Optional: --sac 999293 --rate-bps 1800 (the defaults: coaching, 18%).
import { createHash, randomBytes } from "node:crypto";
import postgres from "postgres";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args.splice(i, 2)[1];
};
const rotate = args.includes("--rotate");
if (rotate) args.splice(args.indexOf("--rotate"), 1);
const sac = flag("--sac", "999293");
const rateBps = Number(flag("--rate-bps", "1800"));
const [slug, name] = args;

if (!slug || (!rotate && !name)) {
  console.error('usage: add-app.mjs <slug> "<name>" [--sac 999293] [--rate-bps 1800] | <slug> --rotate');
  process.exit(1);
}
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.error("add-app: DATABASE_URL is not set");
  process.exit(1);
}

const key = `cb_live_${randomBytes(24).toString("hex")}`;
const hash = createHash("sha256").update(key).digest("hex");
const sql = postgres(url, { max: 1 });
try {
  const rows = rotate
    ? await sql`UPDATE apps SET key_hash = ${hash} WHERE slug = ${slug} RETURNING slug`
    : await sql`INSERT INTO apps (slug, name, sac, gst_rate_bps, key_hash)
                VALUES (${slug}, ${name}, ${sac}, ${rateBps}, ${hash}) RETURNING slug`;
  if (!rows.length) throw new Error(`no app "${slug}"`);
  console.log(`${rotate ? "New key" : "Key"} for ${slug} (shown once, store it as a secret):\n${key}`);
} finally {
  await sql.end();
}
