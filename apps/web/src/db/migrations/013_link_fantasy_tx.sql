-- Link each checking_fantasy_link back to the fantasy_transactions row it represents.
-- fantasy_tx_id IS NULL for old/manual links that have no corresponding fantasy transaction
-- (these are counted separately as "orphan" deposits in the balance formula).
ALTER TABLE checking_fantasy_links ADD COLUMN IF NOT EXISTS fantasy_tx_id VARCHAR;
