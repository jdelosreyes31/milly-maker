-- Remove sold holdings from investment_holdings and sync account totals.
DELETE FROM investment_holdings WHERE COALESCE(is_sold, FALSE) = TRUE;

UPDATE investments SET
  current_value = COALESCE((
    SELECT SUM(current_value)
    FROM investment_holdings
    WHERE investment_id = investments.id
      AND COALESCE(is_sold, FALSE) = FALSE
  ), 0),
  cost_basis = COALESCE((
    SELECT SUM(cost_basis)
    FROM investment_holdings
    WHERE investment_id = investments.id
      AND COALESCE(is_sold, FALSE) = FALSE
  ), 0),
  updated_at = now()
WHERE is_active = TRUE;
