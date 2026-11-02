/**
 * End-to-end against a running server and a scratch database. Skipped unless
 * BILLING_URL and two app keys are given:
 *
 *   BILLING_URL=http://localhost:3100 BILLING_KEY=cb_live_… BILLING_KEY_2=cb_live_… npm test
 *
 * It issues real documents, so never point it at production.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const base = process.env.BILLING_URL;
const key = process.env.BILLING_KEY;
const key2 = process.env.BILLING_KEY_2;
const skip = !base || !key || !key2 ? "set BILLING_URL, BILLING_KEY, BILLING_KEY_2" : false;
const run = `t${Date.now()}`;

async function call(path: string, k: string | null, body?: unknown) {
  const res = await fetch(`${base}/api/v1${path}`, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", ...(k ? { "x-api-key": k } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: res.headers.get("content-type")?.includes("json") ? await res.json() : null };
}

test("invoice, retry, other app, credit note, PDF", { skip }, async () => {
  const paidAt = "2026-11-02T10:00:00Z";
  assert.equal((await call("/invoices", null, {})).status, 401);

  const first = await call("/invoices", key!, {
    paymentRef: `${run}-pay1`, customerRef: `${run}-u1`, amountPaise: 300000, paidAt,
    buyer: { name: "Asha", email: "asha@example.com", stateCode: "32" },
  });
  assert.equal(first.status, 201);
  assert.match(first.body.number, /^CT\/2026-27\/\d{5}$/);
  assert.deepEqual(
    [first.body.taxablePaise, first.body.cgstPaise, first.body.sgstPaise, first.body.igstPaise],
    [254237, 22881, 22882, 0],
  );

  const again = await call("/invoices", key!, { paymentRef: `${run}-pay1`, amountPaise: 300000, paidAt });
  assert.equal(again.status, 200);
  assert.equal(again.body.number, first.body.number);

  // Another app shares the series; out of state is IGST.
  const other = await call("/invoices", key2!, {
    paymentRef: `${run}-pay1`, amountPaise: 300000, paidAt, buyer: { gstin: "29AAOCC1290K1Z7" },
  });
  assert.equal(other.status, 201);
  assert.equal(Number(other.body.number.slice(-5)), Number(first.body.number.slice(-5)) + 1);
  assert.equal(other.body.igstPaise, 45763);
  assert.equal(other.body.placeOfSupply, "29");

  assert.equal((await call("/invoices", key!, { paymentRef: "x", amountPaise: 1, paidAt, buyer: { gstin: "29AAOCC1290K1Z8" } })).status, 400);

  const cn = await call("/credit-notes", key!, {
    paymentRef: `${run}-pay1`, refundRef: `${run}-rf1`, amountPaise: 100000, refundedAt: paidAt,
  });
  assert.equal(cn.status, 201);
  assert.match(cn.body.number, /^CN\/2026-27\/\d{5}$/);
  assert.equal(cn.body.originalNumber, first.body.number);
  const over = await call("/credit-notes", key!, {
    paymentRef: `${run}-pay1`, refundRef: `${run}-rf2`, amountPaise: 200001, refundedAt: paidAt,
  });
  assert.equal(over.status, 422);
  // App 2 cannot credit app 1's payment it never made... its own pay1 exists, so use a ref only app 1 has.
  assert.equal((await call("/credit-notes", key2!, {
    paymentRef: `${run}-nope`, refundRef: `${run}-rf3`, amountPaise: 1, refundedAt: paidAt,
  })).status, 404);

  const list = await call(`/invoices?customerRef=${run}-u1`, key!);
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.items.map((i: { type: string }) => i.type).sort(), ["CREDIT_NOTE", "INVOICE"]);
  assert.equal((await call(`/invoices?customerRef=${run}-u1`, key2!)).body.items.length, 0);

  const pdf = await fetch(first.body.pdfUrl);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get("content-type"), "application/pdf");
  assert.equal((await fetch(first.body.pdfUrl.replace(/token=\w+/, "token=" + "0".repeat(32)))).status, 404);
});
