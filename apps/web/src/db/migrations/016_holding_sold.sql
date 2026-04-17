-- Mark holdings as sold without deleting them.
-- Sold holdings are hidden from the dashboard but still count toward
-- the account's current_value (proceeds remain as buying power).
ALTER TABLE investment_holdings ADD COLUMN is_sold BOOLEAN DEFAULT FALSE;
