ALTER TABLE holding_lots ADD COLUMN IF NOT EXISTS transaction_type VARCHAR DEFAULT 'buy';
