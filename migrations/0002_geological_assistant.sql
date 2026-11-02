-- The first app: Geological Assistant (Kerala PSC course, Supabase USS
-- project). Only the SHA-256 of its key is here; the key itself is the
-- BILLING_API_KEY secret of its payment webhook. Rotate with
-- `npm run add-app -- geological-assistant --rotate`.
INSERT INTO apps (slug, name, key_hash)
VALUES ('geological-assistant', 'Geological Assistant Prep', '5f42e72a71bdced6addf790e78de9d2b29d8fb2026f2722370ea5fba200eb05e');
