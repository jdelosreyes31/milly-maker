CREATE TABLE IF NOT EXISTS subscriptions (
  id              VARCHAR PRIMARY KEY,
  name            VARCHAR NOT NULL,
  amount          DECIMAL(12,2) NOT NULL,
  billing_cycle   VARCHAR NOT NULL DEFAULT 'monthly'
                    CHECK (billing_cycle IN ('weekly', 'monthly', 'quarterly', 'yearly')),
  billing_day     INTEGER,          -- day of month for monthly/quarterly/yearly (1–31)
  source_type     VARCHAR NOT NULL  CHECK (source_type IN ('checking', 'savings', 'debt')),
  source_account_id VARCHAR NOT NULL,
  category        VARCHAR,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  notes           VARCHAR,
  created_at      TIMESTAMP DEFAULT now()
);
