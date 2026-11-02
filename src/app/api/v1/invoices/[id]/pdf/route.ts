/**
 * GET /api/v1/invoices/{id}/pdf?token=…[&download=1]
 *
 * The invoice or credit note as a PDF. No key: the link carries the
 * document's own random token, so whoever holds the link (the buyer) can
 * open it and nobody can guess another. Wrong token and unknown id are the
 * same 404.
 */
import { ApiError, route } from "@/lib/http";
import { findForLink } from "@/lib/issue";
import { invoicePdf } from "@/lib/pdf";

export const dynamic = "force-dynamic";

export const GET = route(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const { id } = await context.params;
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  const invoiceId = Number(id);
  if (!Number.isSafeInteger(invoiceId) || invoiceId <= 0 || !/^[0-9a-f]{32}$/.test(token)) {
    throw new ApiError(404, "NOT_FOUND", "No such invoice");
  }
  const row = await findForLink(invoiceId, token);
  if (!row) throw new ApiError(404, "NOT_FOUND", "No such invoice");

  const bytes = await invoicePdf({
    docType: row.doc_type,
    number: row.number,
    issuedAt: new Date(row.issued_at),
    originalNumber: row.original_number,
    sellerName: row.seller_name,
    sellerAddress: row.seller_address,
    sellerStateCode: row.seller_state_code,
    sellerGstin: row.seller_gstin,
    buyerName: row.buyer_name,
    buyerEmail: row.buyer_email,
    buyerGstin: row.buyer_gstin,
    placeOfSupply: row.place_of_supply,
    paymentRef: row.payment_ref,
    refundRef: row.refund_ref,
    description: row.description,
    sac: row.sac,
    gstRateBps: row.gst_rate_bps,
    taxablePaise: row.taxable_paise,
    cgstPaise: row.cgst_paise,
    sgstPaise: row.sgst_paise,
    igstPaise: row.igst_paise,
    totalPaise: row.total_paise,
  });

  const filename = row.number.replace(/\//g, "-");
  const download = url.searchParams.get("download") === "1";
  return new Response(bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename}.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  });
});
