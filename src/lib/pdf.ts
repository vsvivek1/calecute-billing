/**
 * The invoice or credit note as an A4 PDF, with everything CGST Rule 46 asks
 * of a tax invoice: seller name, address and GSTIN; a consecutive number and
 * date; the buyer (and their GSTIN when they gave one); place of supply with
 * the state; SAC, taxable value, rate and the CGST/SGST or IGST amounts; the
 * total in figures and words.
 *
 * Standard fonts encode Latin-1 only, so the rupee sign is written "Rs." and
 * anything outside Latin-1 in a buyer's name is dropped.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { GST_STATES, amountInWords } from "./gst";

const W = 595; // A4 portrait
const H = 842;
const M = 48;

export interface InvoicePdfInput {
  docType: string;
  number: string;
  issuedAt: Date;
  originalNumber?: string | null;
  sellerName: string;
  sellerAddress: string;
  sellerStateCode: string;
  sellerGstin: string | null;
  buyerName: string | null;
  buyerEmail: string | null;
  buyerGstin: string | null;
  placeOfSupply: string;
  paymentRef: string;
  refundRef: string | null;
  description: string;
  sac: string;
  gstRateBps: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
}

function latin(value: string | null | undefined): string {
  return (value ?? "").replace(/[–—]/g, "-").replace(/[^\x20-\x7E\xA0-\xFF]/g, "").trim();
}

function rs(paise: number): string {
  const rupees = Math.floor(paise / 100).toLocaleString("en-IN");
  return `Rs. ${rupees}.${String(paise % 100).padStart(2, "0")}`;
}

function istDate(d: Date): string {
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}

function stateLabel(code: string): string {
  return `${GST_STATES[code] ?? code} (${code})`;
}

/** Word-wraps `text` into lines no wider than `width`. */
function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > width && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export async function invoicePdf(inv: InvoicePdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page: PDFPage = pdf.addPage([W, H]);
  const grey = rgb(0.4, 0.4, 0.4);

  const credit = inv.docType === "CREDIT_NOTE";
  const taxed = inv.sellerGstin !== null;
  const title = credit ? "Credit Note" : taxed ? "Tax Invoice" : "Receipt";
  pdf.setTitle(`${title} ${inv.number}`);

  const text = (s: string, x: number, y: number, size = 10, f = font, color = rgb(0, 0, 0)) =>
    page.drawText(latin(s), { x, y, size, font: f, color });
  const right = (s: string, xRight: number, y: number, size = 10, f = font) =>
    text(s, xRight - f.widthOfTextAtSize(latin(s), size), y, size, f);
  const rule = (y: number, thickness = 0.5) =>
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness, color: rgb(0.2, 0.2, 0.2) });

  let y = H - M;
  text(title, M, y - 18, 20, bold);

  // Seller, top right.
  let sy = y - 6;
  for (const line of wrap(latin(inv.sellerName), bold, 10, 260)) {
    right(line, W - M, sy, 10, bold);
    sy -= 13;
  }
  for (const line of wrap(latin(inv.sellerAddress), font, 9, 260)) {
    right(line, W - M, sy, 9);
    sy -= 12;
  }
  if (inv.sellerGstin) {
    right(`GSTIN ${inv.sellerGstin}`, W - M, sy, 9, bold);
    sy -= 12;
  }
  right(`State: ${stateLabel(inv.sellerStateCode)}`, W - M, sy, 9);
  sy -= 12;

  y -= 40;
  text(`${credit ? "Credit note" : taxed ? "Invoice" : "Receipt"} no.`, M, y, 9, font, grey);
  text(inv.number, M + 80, y, 10, bold);
  y -= 14;
  text("Date", M, y, 9, font, grey);
  text(istDate(inv.issuedAt), M + 80, y, 10);
  if (credit && inv.originalNumber) {
    y -= 14;
    text("Against invoice", M, y, 9, font, grey);
    text(inv.originalNumber, M + 80, y, 10);
  }

  y = Math.min(y, sy) - 16;
  rule(y, 1.2);
  y -= 20;

  // Buyer and supply details.
  text("Billed to", M, y, 9, font, grey);
  text("Place of supply", 330, y, 9, font, grey);
  text(stateLabel(inv.placeOfSupply), 420, y, 10);
  y -= 14;
  text(inv.buyerName || inv.buyerEmail || "Customer", M, y, 11, bold);
  if (taxed) {
    text("Reverse charge", 330, y, 9, font, grey);
    text("No", 420, y, 10);
  }
  y -= 14;
  if (inv.buyerName && inv.buyerEmail) {
    text(inv.buyerEmail, M, y, 10);
  }
  text("Payment ref.", 330, y, 9, font, grey);
  text(inv.paymentRef, 420, y, 9);
  y -= 14;
  if (inv.buyerGstin) text(`GSTIN ${inv.buyerGstin}`, M, y, 10);
  if (inv.refundRef) {
    text("Refund ref.", 330, y, 9, font, grey);
    text(inv.refundRef, 420, y, 9);
  }
  y -= 26;

  // The line.
  const colSac = 330;
  const colQty = 400;
  text("Description", M, y, 9, bold);
  text("SAC", colSac, y, 9, bold);
  text("Qty", colQty, y, 9, bold);
  right(taxed ? "Taxable value" : "Amount", W - M, y, 9, bold);
  y -= 6;
  rule(y);
  y -= 16;
  const descLines = wrap(latin(inv.description), font, 10, colSac - M - 10);
  descLines.forEach((line, i) => text(line, M, y - i * 13, 10));
  text(inv.sac, colSac, y, 10);
  text("1", colQty, y, 10);
  right(rs(inv.taxablePaise), W - M, y, 10);
  y -= Math.max(descLines.length, 1) * 13 + 4;
  rule(y);

  const pct = (bp: number) => `${bp / 100}%`;
  const taxRows: Array<[string, number]> = !taxed
    ? []
    : inv.igstPaise > 0
      ? [[`IGST @ ${pct(inv.gstRateBps)}`, inv.igstPaise]]
      : [
          [`CGST @ ${pct(inv.gstRateBps / 2)}`, inv.cgstPaise],
          [`SGST @ ${pct(inv.gstRateBps / 2)}`, inv.sgstPaise],
        ];
  for (const [label, value] of taxRows) {
    y -= 16;
    text(label, colSac, y, 10);
    right(rs(value), W - M, y, 10);
  }
  y -= 10;
  rule(y, 1.2);
  y -= 18;
  text(credit ? "Total credited" : "Total paid", colSac, y, 11, bold);
  right(rs(inv.totalPaise), W - M, y, 11, bold);
  y -= 26;

  text(`Amount in words: ${amountInWords(inv.totalPaise)}`, M, y, 9);
  y -= 16;
  if (!taxed) {
    text("The seller is not registered under GST, so no GST is charged.", M, y, 9, font, grey);
    y -= 14;
  } else if (!credit) {
    text("Price is inclusive of GST.", M, y, 9, font, grey);
    y -= 14;
  }

  text(
    `This is a computer-generated ${title.toLowerCase()} and does not need a signature.`,
    M,
    M,
    8,
    font,
    grey,
  );
  return pdf.save();
}
