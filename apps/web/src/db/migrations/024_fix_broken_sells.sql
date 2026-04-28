-- Mark holdings that have 0 shares + 0 value but positive cost_basis as sold
-- These are remnants of a broken sell path that zeroed shares but didn't mark is_sold
UPDATE investment_holdings
SET is_sold = TRUE, updated_at = now()
WHERE COALESCE(shares, 0) = 0
  AND current_value = 0
  AND cost_basis > 0
  AND COALESCE(is_sold, FALSE) = FALSE;

-- Re-sync account totals so cost_basis no longer includes the phantom holding
UPDATE investments SET
  current_value = (
    SELECT COALESCE(SUM(current_value), 0)
    FROM investment_holdings
    WHERE investment_id = investments.id
      AND COALESCE(is_sold, FALSE) = FALSE
  ),
  cost_basis = (
    SELECT COALESCE(SUM(cost_basis), 0)
    FROM investment_holdings
    WHERE investment_id = investments.id
      AND COALESCE(is_sold, FALSE) = FALSE
  ),
  updated_at = now();
