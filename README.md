# Calecute billing

GST tax invoices and credit notes for every Calecute app, under one GSTIN.

Calecute Technologies (OPC) Private Limited sells many apps and courses under
one GST registration, **32AAOCC1290K1ZK**. The law wants one consecutive invoice
series per financial year for the whole registration (CGST Rule 46(b)), not one
per app. So no app numbers its own invoices. After a payment, an app's server
asks this service for the invoice, then stores the number and PDF link it gets
back.

- Invoices: `CT/2026-27/00001`, `CT/2026-27/00002`, … shared by every app. A new series starts each April.
- Credit notes for refunds: `CN/2026-27/00001`, …
- Prices are GST-inclusive. ₹3,000 at 18% is ₹2,542.37 + ₹457.63 GST.
- Buyer in Kerala (or state unknown): CGST 9% + SGST 9%. Other state: IGST 18%.
- Place of supply: the state in the buyer's GSTIN, else the state they chose, else Kerala.
- Issued documents can't be edited or deleted. A mistake is fixed with a credit note.

## API

Every call except the PDF link needs the app's key in `X-Api-Key`. Call
**from your server only** (webhook, backend), never from a client app.

### `POST /api/v1/invoices`

After a payment is captured.

```json
{
  "paymentRef": "pay_Nx9...",
  "customerRef": "your-user-id",
  "amountPaise": 300000,
  "paidAt": "2026-11-02T10:00:00Z",
  "description": "Kerala PSC Geological Assistant online course, lifetime access",
  "buyer": { "name": "Asha K", "email": "asha@example.com", "stateCode": "32", "gstin": null }
}
```

Only `paymentRef`, `amountPaise` and `paidAt` are required. `description`
defaults to the app's name. Returns **201** with the invoice, or **200** with
the same invoice if this `paymentRef` was already invoiced, so a retried webhook
is safe.

```json
{
  "id": 1,
  "type": "INVOICE",
  "number": "CT/2026-27/00001",
  "taxablePaise": 254237, "cgstPaise": 22881, "sgstPaise": 22882, "igstPaise": 0, "totalPaise": 300000,
  "pdfUrl": "https://…/api/v1/invoices/1/pdf?token=…",
  "...": "seller, buyer, placeOfSupply, sac, gstRateBps, issuedAt"
}
```

### `POST /api/v1/credit-notes`

After a refund. Body: `paymentRef`, `refundRef`, `amountPaise`, `refundedAt`.
Same 201/200 rule, keyed on `refundRef`. Returns **404** if that payment was
never invoiced, and **422** if refunds would add up to more than the invoice.

### `GET /api/v1/invoices?customerRef=…`

One buyer's invoices and credit notes, newest first. An app only ever sees its own.

### `GET /api/v1/invoices/{id}/pdf?token=…`

The PDF. No key needed: the token in `pdfUrl` is the permission, so give the
link only to the buyer. Add `&download=1` to download instead of opening.

### Errors

`{ "error": { "code": "…", "message": "…", "details": … } }` with 400 (bad
input, including a GSTIN whose check digit is wrong), 401 (no or bad key),
404, 422 or 500.

## Set up

1. Create a Postgres database (Neon). Put its URLs in `.env.local`, as in `.env.example`.
2. `npm install && npm run migrate`
3. Add each app and keep its key. The key is printed once:
   `npm run add-app -- geological-assistant "Geological Assistant Prep"`
   (lost key: `npm run add-app -- geological-assistant --rotate`)
4. Deploy on Vercel: import this repo, set `DATABASE_URL`, `DATABASE_URL_UNPOOLED`
   and optionally `PUBLIC_URL`. Production builds run the migrations. Preview
   builds never touch the database.

Seller details live in the one-row `seller` table. Change them with SQL: new
invoices pick them up, old ones keep what they were issued with.

## Develop

```sh
npm run dev          # http://localhost:3100
npm run typecheck
npm test             # GST maths; plus the end-to-end test when BILLING_URL is set
BILLING_URL=http://localhost:3100 BILLING_KEY=… BILLING_KEY_2=… npm test   # scratch DB only
```

Migrations in `migrations/` are applied once each, in name order. Never edit
an applied one: add a new file.
