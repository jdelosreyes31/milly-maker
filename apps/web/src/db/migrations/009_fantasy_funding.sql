-- Links a checking transaction to a fantasy account as an annotation only.
-- Does NOT affect fantasy account balance.
CREATE TABLE IF NOT EXISTS checking_fantasy_links (
  id                 VARCHAR PRIMARY KEY,
  checking_tx_id     VARCHAR NOT NULL,
  fantasy_account_id VARCHAR NOT NULL,
  notes              VARCHAR,
  created_at         TIMESTAMP DEFAULT now()
);
