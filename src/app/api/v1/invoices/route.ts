/**
 * POST /api/v1/invoices   issue the GST invoice for a captured payment
 * GET  /api/v1/invoices   list one buyer's invoices and credit notes
 *
 * Every Calecute app invoices through here, so the GSTIN has one number
 * series. Call from your server only (webhook, backend), never from a client
 * app: the key must stay secret.
 *
 * POST is idempotent on paymentRef: a retried webhook gets the invoice
 * already issued, with 200 instead of 201. amountPaise is what the buyer
 * paid, GST included.
 */
import { z } from "zod";
import { requireApp } from "@/lib/auth";
import { GST_STATES, isValidGstin } from "@/lib/gst";
import { json, parseJson, route } from "@/lib/http";
import { issueInvoice, listForCustomer, toJson } from "@/lib/issue";

export const dynamic = "force-dynamic";

const ref = z.string().trim().min(1).max(120);

const bodySchema = z.object({
  paymentRef: ref,
  customerRef: ref.nullish(),
  amountPaise: z.number().int().min(1).max(1e11),
  paidAt: z.coerce.date(),
  description: z.string().trim().min(1).max(200).nullish(),
  buyer: z
    .object({
      name: z.string().trim().min(1).max(200).nullish(),
      email: z.string().trim().toLowerCase().email().max(200).nullish(),
      gstin: z.string().trim().toUpperCase().refine(isValidGstin, "Not a valid GSTIN").nullish(),
      stateCode: z.string().trim().refine((c) => c in GST_STATES, "Not a GST state code").nullish(),
    })
    .nullish(),
});

export const POST = route(async (request: Request) => {
  const app = await requireApp(request);
  const body = await parseJson(request, bodySchema);
  const { invoice, created } = await issueInvoice(app, body);
  return json(toJson(request.url, invoice), created ? 201 : 200);
});

export const GET = route(async (request: Request) => {
  const app = await requireApp(request);
  const customerRef = ref.parse(new URL(request.url).searchParams.get("customerRef"));
  const rows = await listForCustomer(app, customerRef);
  return json({ items: rows.map((r) => toJson(request.url, r)) });
});
