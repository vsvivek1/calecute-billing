/**
 * POST /api/v1/credit-notes
 *
 * The credit note for a refund, against the invoice of paymentRef, with the
 * tax reversed in proportion. Partial refunds are fine; refunds beyond the
 * invoice total are refused (422). Idempotent on refundRef. 404 when the
 * payment was never invoiced (paid before invoicing started).
 */
import { z } from "zod";
import { requireApp } from "@/lib/auth";
import { json, parseJson, route } from "@/lib/http";
import { issueCreditNote, toJson } from "@/lib/issue";

export const dynamic = "force-dynamic";

const ref = z.string().trim().min(1).max(120);

const bodySchema = z.object({
  paymentRef: ref,
  refundRef: ref,
  amountPaise: z.number().int().min(1).max(1e11),
  refundedAt: z.coerce.date(),
});

export const POST = route(async (request: Request) => {
  const app = await requireApp(request);
  const body = await parseJson(request, bodySchema);
  const { invoice, created } = await issueCreditNote(app, body);
  return json(toJson(request.url, invoice), created ? 201 : 200);
});
