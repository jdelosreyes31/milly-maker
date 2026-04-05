-- Link debt payments to their checking transaction source
ALTER TABLE debt_payments ADD COLUMN IF NOT EXISTS checking_tx_id VARCHAR;

-- entry_type: 'payment' reduces balance, 'interest'/'fee' increases it
ALTER TABLE debt_payments ADD COLUMN IF NOT EXISTS entry_type VARCHAR DEFAULT 'payment';
