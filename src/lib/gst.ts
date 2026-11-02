/**
 * GST invoice arithmetic and numbering, in one place, in integer paise.
 *
 * Every Calecute app sells under one GSTIN, so every app's invoices share one
 * consecutive series per financial year (CGST Rule 46(b)): CT/2026-27/00001.
 * Credit notes for refunds have their own series: CN/2026-27/00001. Both fit
 * the 16-character limit. The counter lives in the database
 * (next_serial in lib/issue.ts) so a rolled-back issue gives its number back.
 *
 * Prices are GST-inclusive: the amount the buyer paid is split into taxable
 * value and tax. Same state as the seller: CGST + SGST, half each. Another
 * state, or unknown: IGST — except that an unknown buyer state falls back to
 * the seller's (IGST Act s.12(2)(b): supplier location when the recipient's
 * address is not on record), so it is intra-state.
 */

export type InvoiceDocType = "INVOICE" | "CREDIT_NOTE";

export const GSTIN_PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

const GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** True for a well-formed GSTIN whose last character is the right check digit. */
export function isValidGstin(value: string): boolean {
  if (!GSTIN_PATTERN.test(value)) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = GSTIN_CHARS.indexOf(value[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36] === value[14];
}

export interface GstSplit {
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
}

/**
 * Split a GST-inclusive amount. The taxable value is rounded to the nearest
 * paisa and the tax is whatever remains, so the parts always add up to what
 * was paid. With no GSTIN (`registered: false`) nothing is tax.
 */
export function splitGst(
  totalPaise: number,
  options: { rateBps: number; intraState: boolean; registered?: boolean },
): GstSplit {
  if (!Number.isInteger(totalPaise) || totalPaise < 0) {
    throw new RangeError("totalPaise must be a non-negative integer");
  }
  if (options.registered === false || options.rateBps === 0) {
    return { taxablePaise: totalPaise, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, totalPaise };
  }
  const taxablePaise = Math.round((totalPaise * 10000) / (10000 + options.rateBps));
  const tax = totalPaise - taxablePaise;
  if (options.intraState) {
    const cgstPaise = Math.floor(tax / 2);
    return { taxablePaise, cgstPaise, sgstPaise: tax - cgstPaise, igstPaise: 0, totalPaise };
  }
  return { taxablePaise, cgstPaise: 0, sgstPaise: 0, igstPaise: tax, totalPaise };
}

/**
 * Place of supply: the state in the buyer's GSTIN, else the state they gave,
 * else the seller's own.
 */
export function placeOfSupply(params: {
  buyerGstin?: string | null;
  buyerStateCode?: string | null;
  sellerStateCode: string;
}): string {
  return params.buyerGstin?.slice(0, 2) || params.buyerStateCode || params.sellerStateCode;
}

/** "CT/2026-27/00001" for invoices, "CN/2026-27/00001" for credit notes. */
export function formatInvoiceNumber(
  docType: InvoiceDocType,
  financialYear: string,
  serial: number,
): string {
  const prefix = docType === "INVOICE" ? "CT" : "CN";
  return `${prefix}/${financialYear}/${String(serial).padStart(5, "0")}`;
}

/** GST state codes, for printing the place of supply by name. */
export const GST_STATES: Readonly<Record<string, string>> = {
  "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh",
  "05": "Uttarakhand", "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh",
  "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur",
  "15": "Mizoram", "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal",
  "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh",
  "24": "Gujarat", "26": "Dadra and Nagar Haveli and Daman and Diu", "27": "Maharashtra",
  "29": "Karnataka", "30": "Goa", "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu",
  "34": "Puducherry", "35": "Andaman and Nicobar Islands", "36": "Telangana",
  "37": "Andhra Pradesh", "38": "Ladakh",
};

/** "Rupees Three Thousand Only", in the Indian system (lakh, crore). */
export function amountInWords(paise: number): string {
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
    "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (n: number) => (n < 20 ? ones[n] : tens[Math.floor(n / 10)] + (n % 10 ? " " + ones[n % 10] : ""));
  const three = (n: number) =>
    [n >= 100 ? ones[Math.floor(n / 100)] + " Hundred" : "", two(n % 100)].filter(Boolean).join(" ");
  const words = (n: number): string => {
    if (n === 0) return "Zero";
    const parts: string[] = [];
    for (const [size, name] of [[1e7, "Crore"], [1e5, "Lakh"], [1e3, "Thousand"]] as const) {
      if (n >= size) {
        parts.push(words(Math.floor(n / size)) + " " + name);
        n %= size;
      }
    }
    if (n) parts.push(three(n));
    return parts.join(" ");
  };
  const rupees = Math.floor(paise / 100);
  const rest = paise % 100;
  return `Rupees ${words(rupees)}${rest ? ` and ${two(rest)} Paise` : ""} Only`;
}

/** "2026-27" for any moment from 1 April 2026 to 31 March 2027, India time. */
export function financialYearOf(date: Date): string {
  const ist = new Date(date.getTime() + 5.5 * 60 * 60 * 1000);
  const startYear = ist.getUTCMonth() >= 3 ? ist.getUTCFullYear() : ist.getUTCFullYear() - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}
