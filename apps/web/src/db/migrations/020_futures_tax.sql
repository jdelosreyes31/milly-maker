-- Add tax withheld column to fantasy_futures
ALTER TABLE fantasy_futures ADD COLUMN IF NOT EXISTS tax DECIMAL(12,2);
