-- Add tax field to underdog_bets (withheld from payout, reduces net)
ALTER TABLE underdog_bets ADD COLUMN IF NOT EXISTS tax DOUBLE;
