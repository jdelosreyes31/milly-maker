-- Checking accounts (origin point: name + starting balance + starting date)
CREATE TABLE IF NOT EXISTS checking_accounts (
  id              VARCHAR PRIMARY KEY,
  name            VARCHAR NOT NULL,
  starting_balance DECIMAL(12,2) NOT NULL DEFAULT 0,
  starting_date   DATE NOT NULL,
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMP DEFAULT now(),
  updated_at      TIMESTAMP DEFAULT now()
);

-- Checking transactions
-- type: 'debit' | 'credit' | 'transfer'
-- For transfers: transfer_to_account_id is set on the source row;
--   a paired credit row is auto-created on the destination account.
CREATE TABLE IF NOT EXISTS checking_transactions (
  id                      VARCHAR PRIMARY KEY,
  account_id              VARCHAR NOT NULL,
  type                    VARCHAR NOT NULL CHECK (type IN ('debit', 'credit', 'transfer')),
  amount                  DECIMAL(12,2) NOT NULL CHECK (amount > 0),
  description             VARCHAR NOT NULL,
  transaction_date        DATE NOT NULL,
  transfer_to_account_id  VARCHAR,
  transfer_pair_id        VARCHAR,  -- links the debit + credit rows of a transfer
  notes                   VARCHAR,
  created_at              TIMESTAMP DEFAULT now()
);
