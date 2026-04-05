-- DFS / sportsbook contest entries
CREATE TABLE IF NOT EXISTS fantasy_contests (
  id              VARCHAR PRIMARY KEY,
  account_id      VARCHAR NOT NULL,
  description     VARCHAR NOT NULL,
  entry_fee       DECIMAL(12,2) NOT NULL CHECK (entry_fee >= 0),
  contest_size    INTEGER,           -- total entrants
  finish_position INTEGER,           -- where you finished (nullable until settled)
  winnings        DECIMAL(12,2),     -- amount won (nullable = not yet settled)
  placed_date     DATE NOT NULL,     -- date you played / slate date
  settled_date    DATE,              -- date results were known
  notes           VARCHAR,
  created_at      TIMESTAMP DEFAULT now()
);
