import { db } from "@/lib/db";
import { json, route } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  await db()`SELECT 1`;
  return json({ ok: true });
});
