-- Per-month manual targets for the Underdog bet log summary
CREATE TABLE IF NOT EXISTS underdog_monthly_targets (
  id            TEXT PRIMARY KEY,
  account_id    TEXT    NOT NULL REFERENCES fantasy_accounts(id),
  month         TEXT    NOT NULL,   -- YYYY-MM
  target_spend  DOUBLE,             -- Target Spend Max
  target_pl     DOUBLE,             -- Target P/L
  starting_br   DOUBLE,             -- Starting Bankroll
  bonuses       DOUBLE DEFAULT 0,
  UNIQUE(account_id, month)
);
