-- Reactivate any soft-deleted investments and wipe all transactional data
-- so the brokerage can be started fresh with a clean slate.
DELETE FROM holding_lots
WHERE holding_id IN (
  SELECT id FROM investment_holdings
  WHERE investment_id IN (SELECT id FROM investments)
);

DELETE FROM investment_holdings
WHERE investment_id IN (SELECT id FROM investments);

DELETE FROM investment_contributions
WHERE investment_id IN (SELECT id FROM investments);

UPDATE investments
SET is_active = TRUE,
    current_value = 0,
    cost_basis = 0,
    updated_at = now()
WHERE is_active = FALSE;

UPDATE investments
SET current_value = 0,
    cost_basis = 0,
    updated_at = now()
WHERE is_active = TRUE;
