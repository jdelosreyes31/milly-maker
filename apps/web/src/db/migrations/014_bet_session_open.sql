-- Allow bet sessions to be "open" (total_settled NULL) until the user settles them.
ALTER TABLE fantasy_bet_sessions ALTER COLUMN total_settled DROP NOT NULL;
