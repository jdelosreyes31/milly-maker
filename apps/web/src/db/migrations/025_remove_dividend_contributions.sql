-- Dividends are investment income, not contributions.
-- Remove any contribution records that were created for dividends
-- (source_type = 'dividend' or notes starting with 'Dividend').
DELETE FROM investment_contributions
WHERE source_type = 'dividend'
   OR lower(notes) LIKE 'dividend%';
