-- Bet session records: total amount wagered vs. total returned in a session.
-- Net (total_settled - total_bet) flows directly into account balance.
CREATE TABLE IF NOT EXISTS fantasy_bet_sessions (
  id             VARCHAR PRIMARY KEY,
  account_id     VARCHAR NOT NULL,
  session_date   DATE NOT NULL,
  total_bet      DECIMAL(12,2) NOT NULL CHECK (total_bet >= 0),
  total_settled  DECIMAL(12,2) NOT NULL CHECK (total_settled >= 0),
  notes          VARCHAR,
  created_at     TIMESTAMP DEFAULT now()
);
