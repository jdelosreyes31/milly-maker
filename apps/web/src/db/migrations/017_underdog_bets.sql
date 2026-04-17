-- Underdog (DFS) individual bet entry log
CREATE TABLE IF NOT EXISTS underdog_bets (
  id            TEXT PRIMARY KEY,
  account_id    TEXT    NOT NULL REFERENCES fantasy_accounts(id),
  entry_date    TEXT    NOT NULL,          -- YYYY-MM-DD
  entry_id      TEXT,                      -- UUID from Underdog (optional)
  oddsjam_hit   DOUBLE,                   -- OddsJam % chance to hit  (e.g. 0.0245)
  oddsjam_ev    DOUBLE,                   -- OddsJam +EV %            (e.g. 0.0216)
  ev_amount     DOUBLE,                   -- EV dollar amount
  bet_type      TEXT    NOT NULL DEFAULT '6-Man Insured',
  entry_size    DOUBLE  NOT NULL,         -- amount entered ($)
  legs          INTEGER NOT NULL DEFAULT 6,
  legs_hit      INTEGER,                  -- NULL = pending
  legs_pushed   INTEGER DEFAULT 0,        -- reboot / DNP
  settled       DOUBLE,                   -- payout received; NULL = pending
  rescued       BOOLEAN DEFAULT FALSE,
  promo         TEXT,
  notes         TEXT,
  created_at    TIMESTAMP DEFAULT NOW()
);
