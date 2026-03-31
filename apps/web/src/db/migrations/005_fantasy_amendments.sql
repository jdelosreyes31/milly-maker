-- Add optional end_date to fantasy accounts (useful for leagues with a season end)
ALTER TABLE fantasy_accounts ADD COLUMN end_date DATE;

-- Fantasy seasons — per-league season tracking (similar concept to futures)
CREATE TABLE IF NOT EXISTS fantasy_seasons (
  id               VARCHAR PRIMARY KEY,
  account_id       VARCHAR NOT NULL,
  description      VARCHAR NOT NULL,
  season_year      VARCHAR,
  buy_in           DECIMAL(12,2) NOT NULL DEFAULT 0,
  potential_payout DECIMAL(12,2),
  placement        VARCHAR,
  status           VARCHAR NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'won', 'lost', 'ended')),
  start_date       DATE NOT NULL,
  end_date         DATE,
  notes            VARCHAR,
  created_at       TIMESTAMP DEFAULT now()
);
