-- Fantasy / sportsbook / DFS accounts
CREATE TABLE IF NOT EXISTS fantasy_accounts (
  id               VARCHAR PRIMARY KEY,
  name             VARCHAR NOT NULL,
  platform_type    VARCHAR NOT NULL DEFAULT 'sportsbook'
                     CHECK (platform_type IN ('sportsbook', 'dfs', 'fantasy_league', 'other')),
  starting_balance DECIMAL(12,2) NOT NULL DEFAULT 0,
  starting_date    DATE NOT NULL,
  is_active        BOOLEAN DEFAULT true,
  created_at       TIMESTAMP DEFAULT now(),
  updated_at       TIMESTAMP DEFAULT now()
);

-- Deposits into and cashouts out of a fantasy account
CREATE TABLE IF NOT EXISTS fantasy_transactions (
  id               VARCHAR PRIMARY KEY,
  account_id       VARCHAR NOT NULL,
  type             VARCHAR NOT NULL CHECK (type IN ('deposit', 'cashout')),
  amount           DECIMAL(12,2) NOT NULL CHECK (amount > 0),
  description      VARCHAR NOT NULL,
  transaction_date DATE NOT NULL,
  notes            VARCHAR,
  created_at       TIMESTAMP DEFAULT now()
);

-- Futures (season-long or multi-game bets only — not individual/daily)
CREATE TABLE IF NOT EXISTS fantasy_futures (
  id               VARCHAR PRIMARY KEY,
  account_id       VARCHAR NOT NULL,
  description      VARCHAR NOT NULL,
  stake            DECIMAL(12,2) NOT NULL CHECK (stake > 0),
  potential_payout DECIMAL(12,2),
  odds             VARCHAR,
  status           VARCHAR NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open', 'won', 'lost', 'void')),
  placed_date      DATE NOT NULL,
  settled_date     DATE,
  notes            VARCHAR,
  created_at       TIMESTAMP DEFAULT now()
);
