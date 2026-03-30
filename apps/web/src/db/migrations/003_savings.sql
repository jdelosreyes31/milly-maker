-- Savings accounts (HYSA, HSA, general savings)
CREATE TABLE IF NOT EXISTS savings_accounts (
  id               VARCHAR PRIMARY KEY,
  name             VARCHAR NOT NULL,
  account_type     VARCHAR NOT NULL DEFAULT 'hysa' CHECK (account_type IN ('hysa', 'hsa', 'savings', 'other')),
  starting_balance DECIMAL(12,2) NOT NULL DEFAULT 0,
  starting_date    DATE NOT NULL,
  apr              DECIMAL(6,4) NOT NULL DEFAULT 0,
  is_active        BOOLEAN DEFAULT true,
  created_at       TIMESTAMP DEFAULT now(),
  updated_at       TIMESTAMP DEFAULT now()
);

-- Savings transactions
CREATE TABLE IF NOT EXISTS savings_transactions (
  id               VARCHAR PRIMARY KEY,
  account_id       VARCHAR NOT NULL,
  type             VARCHAR NOT NULL CHECK (type IN ('deposit', 'withdrawal', 'interest', 'transfer_in')),
  amount           DECIMAL(12,2) NOT NULL CHECK (amount > 0),
  description      VARCHAR NOT NULL,
  transaction_date DATE NOT NULL,
  transfer_pair_id VARCHAR,
  notes            VARCHAR,
  created_at       TIMESTAMP DEFAULT now()
);
