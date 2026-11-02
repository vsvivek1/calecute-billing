/**
 * Apps call with their own key in X-Api-Key. Only its SHA-256 is stored, so a
 * leaked database does not leak keys. Keys are created by scripts/add-app.mjs.
 */
import { createHash, randomBytes } from "node:crypto";
import { db } from "./db";
import { ApiError } from "./http";

export interface App {
  id: number;
  slug: string;
  name: string;
  sac: string;
  gstRateBps: number;
}

export const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

export const newKey = () => `cb_live_${randomBytes(24).toString("hex")}`;

export async function requireApp(request: Request): Promise<App> {
  const key = request.headers.get("x-api-key")?.trim();
  if (!key) throw new ApiError(401, "NO_KEY", "Send your app's key in X-Api-Key");
  const [app] = await db()<App[]>`
    SELECT id, slug, name, sac, gst_rate_bps AS "gstRateBps"
      FROM apps WHERE key_hash = ${hashKey(key)} AND active`;
  if (!app) throw new ApiError(401, "BAD_KEY", "Unknown or disabled key");
  return app;
}
