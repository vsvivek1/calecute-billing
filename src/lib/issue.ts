/**
 * Issuing invoices and credit notes. The arithmetic is in gst.ts; this is the
 * database side.
 *
 * Idempotent on the app's own references: a second call for the same payment
 * (or refund) returns the document already issued. A transaction-scoped
 * advisory lock on that reference serialises concurrent retries, so two
 * webhook deliveries arriving together cannot both take a number.
 */
import type { App } from "./auth";
import { db, type Tx } from "./db";
import { ApiError } from "./http";
import {
  financialYearOf,
  formatInvoiceNumber,
  placeOfSupply,
  splitGst,
  type InvoiceDocType,
} from "./gst";

export interface InvoiceRow {
  id: number;
  doc_type: InvoiceDocType;
  number: string;
  financial_year: string;
  issued_at: Date;
  app_id: number;
  payment_ref: string;
  refund_ref: string | null;
  original_invoice_id: number | null;
  customer_ref: string | null;
  seller_name: string;
  seller_address: string;
  seller_state_code: string;
  seller_gstin: string | null;
  buyer_name: string | null;
  buyer_email: string | null;
  buyer_gstin: string | null;
  place_of_supply: string;
  description: string;
  sac: string;
  gst_rate_bps: number;
  taxable_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  total_paise: number;
  view_token: string;
}

export interface IssueInvoiceInput {
  paymentRef: string;
  customerRef?: string | null;
  amountPaise: number;
  paidAt: Date;
  description?: string | null;
  buyer?: {
    name?: string | null;
    email?: string | null;
    gstin?: string | null;
    stateCode?: string | null;
  } | null;
}

export interface IssueCreditNoteInput {
  paymentRef: string;
  refundRef: string;
  amountPaise: number;
  refundedAt: Date;
}

/** bigint columns come back as strings; the amounts all fit in a double. */
function normalise(row: Record<string, unknown>): InvoiceRow {
  const r = row as unknown as InvoiceRow;
  for (const k of ["id", "original_invoice_id", "taxable_paise", "cgst_paise", "sgst_paise", "igst_paise", "total_paise"] as const) {
    if (r[k] !== null) (r as unknown as Record<string, unknown>)[k] = Number(r[k]);
  }
  return r;
}

async function lock(tx: Tx, key: string) {
  await tx`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

async function nextNumber(tx: Tx, docType: InvoiceDocType, at: Date) {
  const financialYear = financialYearOf(at);
  const [{ serial }] = await tx<{ serial: number }[]>`
    INSERT INTO counters AS c (doc_type, financial_year, last_serial)
    VALUES (${docType}, ${financialYear}, 1)
    ON CONFLICT (doc_type, financial_year) DO UPDATE SET last_serial = c.last_serial + 1
    RETURNING last_serial AS serial`;
  return { financialYear, number: formatInvoiceNumber(docType, financialYear, serial) };
}

export async function issueInvoice(
  app: App,
  input: IssueInvoiceInput,
): Promise<{ invoice: InvoiceRow; created: boolean }> {
  return db().begin(async (tx) => {
    await lock(tx, `invoice:${app.id}:${input.paymentRef}`);
    const [existing] = await tx`
      SELECT * FROM invoices
       WHERE app_id = ${app.id} AND payment_ref = ${input.paymentRef} AND doc_type = 'INVOICE'`;
    if (existing) return { invoice: normalise(existing), created: false };

    const [s] = await tx`SELECT * FROM seller`;
    if (!s) throw new ApiError(500, "NO_SELLER", "Seller details are not set");
    const pos = placeOfSupply({
      buyerGstin: input.buyer?.gstin,
      buyerStateCode: input.buyer?.stateCode,
      sellerStateCode: s.state_code,
    });
    const registered = s.gstin !== null;
    const split = splitGst(input.amountPaise, {
      rateBps: app.gstRateBps,
      intraState: pos === s.state_code,
      registered,
    });
    const { financialYear, number } = await nextNumber(tx, "INVOICE", input.paidAt);

    const [row] = await tx`
      INSERT INTO invoices (
        doc_type, number, financial_year, issued_at, app_id, payment_ref, customer_ref,
        seller_name, seller_address, seller_state_code, seller_gstin,
        buyer_name, buyer_email, buyer_gstin, place_of_supply,
        description, sac, gst_rate_bps,
        taxable_paise, cgst_paise, sgst_paise, igst_paise, total_paise)
      VALUES (
        'INVOICE', ${number}, ${financialYear}, ${input.paidAt}, ${app.id}, ${input.paymentRef},
        ${input.customerRef ?? null},
        ${s.legal_name}, ${s.address}, ${s.state_code}, ${s.gstin},
        ${input.buyer?.name ?? null}, ${input.buyer?.email ?? null}, ${input.buyer?.gstin ?? null}, ${pos},
        ${input.description || app.name}, ${app.sac}, ${registered ? app.gstRateBps : 0},
        ${split.taxablePaise}, ${split.cgstPaise}, ${split.sgstPaise}, ${split.igstPaise}, ${split.totalPaise})
      RETURNING *`;
    return { invoice: normalise(row), created: true };
  });
}

/**
 * A credit note against a payment's invoice, with the tax reversed in
 * proportion. 404 when the payment was never invoiced; 422 when refunds
 * would add up to more than the invoice.
 */
export async function issueCreditNote(
  app: App,
  input: IssueCreditNoteInput,
): Promise<{ invoice: InvoiceRow & { original_number?: string | null }; created: boolean }> {
  return db().begin(async (tx) => {
    await lock(tx, `credit:${app.id}:${input.refundRef}`);
    const [existing] = await tx`
      SELECT i.*, o.number AS original_number
        FROM invoices i JOIN invoices o ON o.id = i.original_invoice_id
       WHERE i.app_id = ${app.id} AND i.refund_ref = ${input.refundRef} AND i.doc_type = 'CREDIT_NOTE'`;
    if (existing) return { invoice: normalise(existing), created: false };

    const [originalRow] = await tx`
      SELECT * FROM invoices
       WHERE app_id = ${app.id} AND payment_ref = ${input.paymentRef} AND doc_type = 'INVOICE'
       FOR UPDATE`;
    if (!originalRow) throw new ApiError(404, "NO_INVOICE", "No invoice for that paymentRef");
    const original = normalise(originalRow);

    const [{ credited }] = await tx<{ credited: string }[]>`
      SELECT coalesce(sum(total_paise), 0) AS credited FROM invoices
       WHERE original_invoice_id = ${original.id} AND doc_type = 'CREDIT_NOTE'`;
    if (Number(credited) + input.amountPaise > original.total_paise) {
      throw new ApiError(422, "OVER_REFUND", "Refunds would exceed the invoice total", {
        invoiceTotalPaise: original.total_paise,
        alreadyCreditedPaise: Number(credited),
      });
    }

    const split = splitGst(input.amountPaise, {
      rateBps: original.gst_rate_bps,
      intraState: original.place_of_supply === original.seller_state_code,
      registered: original.seller_gstin !== null,
    });
    const { financialYear, number } = await nextNumber(tx, "CREDIT_NOTE", input.refundedAt);

    const [row] = await tx`
      INSERT INTO invoices (
        doc_type, number, financial_year, issued_at, app_id, payment_ref, refund_ref,
        original_invoice_id, customer_ref,
        seller_name, seller_address, seller_state_code, seller_gstin,
        buyer_name, buyer_email, buyer_gstin, place_of_supply,
        description, sac, gst_rate_bps,
        taxable_paise, cgst_paise, sgst_paise, igst_paise, total_paise)
      VALUES (
        'CREDIT_NOTE', ${number}, ${financialYear}, ${input.refundedAt}, ${app.id},
        ${original.payment_ref}, ${input.refundRef}, ${original.id}, ${original.customer_ref},
        ${original.seller_name}, ${original.seller_address}, ${original.seller_state_code}, ${original.seller_gstin},
        ${original.buyer_name}, ${original.buyer_email}, ${original.buyer_gstin}, ${original.place_of_supply},
        ${`Refund against invoice ${original.number}`}, ${original.sac}, ${original.gst_rate_bps},
        ${split.taxablePaise}, ${split.cgstPaise}, ${split.sgstPaise}, ${split.igstPaise}, ${split.totalPaise})
      RETURNING *`;
    return { invoice: { ...normalise(row), original_number: original.number }, created: true };
  });
}

export async function listForCustomer(app: App, customerRef: string): Promise<InvoiceRow[]> {
  const rows = await db()`
    SELECT i.*, o.number AS original_number
      FROM invoices i LEFT JOIN invoices o ON o.id = i.original_invoice_id
     WHERE i.app_id = ${app.id} AND i.customer_ref = ${customerRef}
     ORDER BY i.issued_at DESC, i.id DESC
     LIMIT 200`;
  return rows.map(normalise);
}

/** For the public PDF link: id and token must both match. */
export async function findForLink(id: number, token: string) {
  const [row] = await db()`
    SELECT i.*, o.number AS original_number
      FROM invoices i LEFT JOIN invoices o ON o.id = i.original_invoice_id
     WHERE i.id = ${id} AND i.view_token = ${token}`;
  return row ? (normalise(row) as InvoiceRow & { original_number: string | null }) : null;
}

/** An invoice as the API returns it. `pdfUrl` opens without any key. */
export function toJson(requestUrl: string, row: InvoiceRow & { original_number?: string | null }) {
  const origin = process.env.PUBLIC_URL?.replace(/\/+$/, "") || new URL(requestUrl).origin;
  return {
    id: row.id,
    type: row.doc_type,
    number: row.number,
    financialYear: row.financial_year,
    issuedAt: new Date(row.issued_at).toISOString(),
    paymentRef: row.payment_ref,
    refundRef: row.refund_ref,
    originalNumber: row.original_number ?? null,
    customerRef: row.customer_ref,
    seller: {
      name: row.seller_name,
      address: row.seller_address,
      stateCode: row.seller_state_code,
      gstin: row.seller_gstin,
    },
    buyer: { name: row.buyer_name, email: row.buyer_email, gstin: row.buyer_gstin },
    placeOfSupply: row.place_of_supply,
    description: row.description,
    sac: row.sac,
    gstRateBps: row.gst_rate_bps,
    taxablePaise: row.taxable_paise,
    cgstPaise: row.cgst_paise,
    sgstPaise: row.sgst_paise,
    igstPaise: row.igst_paise,
    totalPaise: row.total_paise,
    pdfUrl: `${origin}/api/v1/invoices/${row.id}/pdf?token=${row.view_token}`,
  };
}
