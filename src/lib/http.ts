/** JSON responses and the one error shape every route returns. */
import { ZodError, type ZodType } from "zod";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function parseJson<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ApiError(400, "BAD_JSON", "Body must be JSON");
  }
  return schema.parse(raw);
}

/** Wraps a route so every failure comes back as { error: { code, message } }. */
export function route<C>(fn: (request: Request, context: C) => Promise<Response>) {
  return async (request: Request, context: C): Promise<Response> => {
    try {
      return await fn(request, context);
    } catch (e) {
      if (e instanceof ApiError) {
        return json({ error: { code: e.code, message: e.message, details: e.details } }, e.status);
      }
      if (e instanceof ZodError) {
        return json({ error: { code: "INVALID", message: "Invalid request", details: e.issues } }, 400);
      }
      console.error(e);
      return json({ error: { code: "INTERNAL", message: "Something went wrong" } }, 500);
    }
  };
}
