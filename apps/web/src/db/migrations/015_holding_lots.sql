-- Individual buy lots for a holding (shares purchased at a given price)
CREATE TABLE IF NOT EXISTS holding_lots (
  id              VARCHAR PRIMARY KEY,
  holding_id      VARCHAR NOT NULL,
  shares          DECIMAL(16,6) NOT NULL,
  price_per_share DECIMAL(12,4) NOT NULL,
  purchased_at    DATE NOT NULL DEFAULT current_date,
  notes           VARCHAR,
  created_at      TIMESTAMP DEFAULT now()
);
