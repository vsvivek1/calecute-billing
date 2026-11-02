/**
 * GST invoice arithmetic and numbering, checked without a database.
 *
 *   npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  amountInWords,
  financialYearOf,
  formatInvoiceNumber,
  isValidGstin,
  placeOfSupply,
  splitGst,
} from "../src/lib/gst.ts";

test("Rs 3,000 inclusive of 18% in Kerala: CGST + SGST that add back up", () => {
  const s = splitGst(300000, { rateBps: 1800, intraState: true });
  assert.deepEqual(s, { taxablePaise: 254237, cgstPaise: 22881, sgstPaise: 22882, igstPaise: 0, totalPaise: 300000 });
});

test("another state pays IGST", () => {
  const s = splitGst(240000, { rateBps: 1800, intraState: false });
  assert.deepEqual(s, { taxablePaise: 203390, cgstPaise: 0, sgstPaise: 0, igstPaise: 36610, totalPaise: 240000 });
});

test("parts always add up to the amount paid", () => {
  for (let paise = 1; paise < 50000; paise += 37) {
    for (const intraState of [true, false]) {
      const s = splitGst(paise, { rateBps: 1800, intraState });
      assert.equal(s.taxablePaise + s.cgstPaise + s.sgstPaise + s.igstPaise, paise);
    }
  }
});

test("an unregistered seller charges no tax", () => {
  const s = splitGst(300000, { rateBps: 1800, intraState: true, registered: false });
  assert.equal(s.taxablePaise, 300000);
  assert.equal(s.cgstPaise + s.sgstPaise + s.igstPaise, 0);
});

test("place of supply: GSTIN state, then given state, then seller's", () => {
  assert.equal(placeOfSupply({ buyerGstin: "29ABCDE1234F1Z5", buyerStateCode: "32", sellerStateCode: "32" }), "29");
  assert.equal(placeOfSupply({ buyerStateCode: "33", sellerStateCode: "32" }), "33");
  assert.equal(placeOfSupply({ sellerStateCode: "32" }), "32");
});

test("numbers fit the 16-character limit", () => {
  assert.equal(formatInvoiceNumber("INVOICE", "2026-27", 1), "CT/2026-27/00001");
  assert.equal(formatInvoiceNumber("CREDIT_NOTE", "2026-27", 42), "CN/2026-27/00042");
  assert.ok(formatInvoiceNumber("INVOICE", "2026-27", 99999).length <= 16);
});

test("financial year turns over at midnight 1 April, India time", () => {
  assert.equal(financialYearOf(new Date("2027-03-31T18:29:00Z")), "2026-27");
  assert.equal(financialYearOf(new Date("2027-03-31T18:31:00Z")), "2027-28");
  // New Year's Eve in UTC is already 1 January in India: still the same FY.
  assert.equal(financialYearOf(new Date("2026-12-31T19:00:00Z")), "2026-27");
});

test("GSTIN check digit", () => {
  assert.equal(isValidGstin("32AAOCC1290K1ZK"), true);
  assert.equal(isValidGstin("32AAOCC1290K1ZA"), false);
  assert.equal(isValidGstin("not a gstin"), false);
});

test("amount in words, Indian system", () => {
  assert.equal(amountInWords(300000), "Rupees Three Thousand Only");
  assert.equal(amountInWords(254237), "Rupees Two Thousand Five Hundred Forty Two and Thirty Seven Paise Only");
  assert.equal(amountInWords(1234567800), "Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Only");
});
