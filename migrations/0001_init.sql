-- Calecute billing: GST tax invoices and credit notes for every Calecute app,
-- under one GSTIN.
--
-- The law wants one consecutive invoice series per financial year for the
-- whole GST registration (CGST Rule 46(b)), not one per app. So every app
-- asks this service for its invoices: it keeps the series, the tax split and
-- the PDF, and the app keeps only the number and link it gets back.

-- ---------------------------------------------------------------- seller
-- One row: the registration every invoice is issued under. Each invoice
-- copies these fields when issued, so editing this row never changes an
-- invoice that already went out. A null GSTIN issues plain receipts with no
-- tax (an unregistered seller cannot charge GST).
CREATE TABLE seller (
  id          boolean PRIMARY KEY DEFAULT true CHECK (id),
  legal_name  text NOT NULL,
  address     text NOT NULL,
  state_code  text NOT NULL CHECK (state_code ~ '^\d{2}$'),
  gstin       text CHECK (gstin ~ '^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  email       text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO seller (legal_name, address, state_code, gstin, email)
VALUES (
  'CALECUTE TECHNOLOGIES (OPC) PRIVATE LIMITED',
  '11/698A, Poolakadavu, Marikkunnu (PO), Kozhikode 673012, Kerala, India',
  '32',
  '32AAOCC1290K1ZK',
  'info@calecutech.com'
);

-- ------------------------------------------------------------------ apps
-- Each app or product that sells. Its API key is stored only as a SHA-256
-- hash (scripts/add-app.mjs prints the key once). SAC and rate decide how
-- its sales are taxed: 999293 is commercial training and coaching, 18%.
CREATE TABLE apps (
  id            serial PRIMARY KEY,
  slug          text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name          text NOT NULL,
  sac           text NOT NULL DEFAULT '999293',
  gst_rate_bps  smallint NOT NULL DEFAULT 1800 CHECK (gst_rate_bps BETWEEN 0 AND 2800),
  key_hash      text NOT NULL UNIQUE,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- -------------------------------------------------------------- counters
-- Shared by every app. The row is locked until the issuing transaction ends,
-- and a rollback gives its number back, so the series has no gaps.
CREATE TABLE counters (
  doc_type        text NOT NULL CHECK (doc_type IN ('INVOICE', 'CREDIT_NOTE')),
  financial_year  text NOT NULL,
  last_serial     integer NOT NULL DEFAULT 0,
  PRIMARY KEY (doc_type, financial_year)
);

-- -------------------------------------------------------------- invoices
CREATE TABLE invoices (
  id                   bigserial PRIMARY KEY,
  doc_type             text NOT NULL CHECK (doc_type IN ('INVOICE', 'CREDIT_NOTE')),
  number               text NOT NULL UNIQUE,
  financial_year       text NOT NULL,
  issued_at            timestamptz NOT NULL,
  app_id               integer NOT NULL REFERENCES apps(id),
  -- The app's own payment id (Razorpay pay_…, Play order id).
  payment_ref          text NOT NULL,
  -- Credit notes only: the refund id, and the invoice being credited.
  refund_ref           text,
  original_invoice_id  bigint REFERENCES invoices(id),
  -- The app's own user id, so it can list one buyer's documents.
  customer_ref         text,
  seller_name          text NOT NULL,
  seller_address       text NOT NULL,
  seller_state_code    text NOT NULL,
  seller_gstin         text,
  buyer_name           text,
  buyer_email          text,
  buyer_gstin          text,
  place_of_supply      text NOT NULL,
  description          text NOT NULL,
  sac                  text NOT NULL,
  gst_rate_bps         smallint NOT NULL,
  taxable_paise        bigint NOT NULL CHECK (taxable_paise >= 0),
  cgst_paise           bigint NOT NULL DEFAULT 0 CHECK (cgst_paise >= 0),
  sgst_paise           bigint NOT NULL DEFAULT 0 CHECK (sgst_paise >= 0),
  igst_paise           bigint NOT NULL DEFAULT 0 CHECK (igst_paise >= 0),
  total_paise          bigint NOT NULL,
  -- Whoever holds the PDF link can open it; nobody can guess another.
  view_token           text NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', ''),
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoices_parts_add_up
    CHECK (taxable_paise + cgst_paise + sgst_paise + igst_paise = total_paise),
  CONSTRAINT invoices_credit_note_shape
    CHECK ((doc_type = 'CREDIT_NOTE') = (refund_ref IS NOT NULL AND original_invoice_id IS NOT NULL))
);

-- One invoice per payment, one credit note per refund, per app.
CREATE UNIQUE INDEX invoices_one_per_payment
  ON invoices (app_id, payment_ref) WHERE doc_type = 'INVOICE';
CREATE UNIQUE INDEX invoices_one_per_refund
  ON invoices (app_id, refund_ref) WHERE doc_type = 'CREDIT_NOTE';
CREATE INDEX invoices_customer_idx ON invoices (app_id, customer_ref, issued_at DESC);

-- An issued document is never edited or deleted; a mistake is corrected
-- with a credit note.
CREATE FUNCTION invoices_are_final() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Issued invoices cannot be changed or deleted; issue a credit note';
END $$;

CREATE TRIGGER invoices_no_update_delete
  BEFORE UPDATE OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION invoices_are_final();
