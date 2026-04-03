-- Individual holdings within an investment account
CREATE TABLE IF NOT EXISTS investment_holdings (
  id            VARCHAR PRIMARY KEY,
  investment_id VARCHAR NOT NULL,
  name          VARCHAR NOT NULL,
  ticker        VARCHAR,
  shares        DECIMAL(16,6),
  current_value DECIMAL(12,2) NOT NULL DEFAULT 0,
  cost_basis    DECIMAL(12,2) DEFAULT 0,
  asset_class   VARCHAR NOT NULL DEFAULT 'stocks',
  created_at    TIMESTAMP DEFAULT now(),
  updated_at    TIMESTAMP DEFAULT now()
);

-- Contribution events: money moved into an investment account
CREATE TABLE IF NOT EXISTS investment_contributions (
  id                VARCHAR PRIMARY KEY,
  investment_id     VARCHAR NOT NULL,
  amount            DECIMAL(12,2) NOT NULL,
  contribution_date DATE NOT NULL DEFAULT current_date,
  source_type       VARCHAR NOT NULL DEFAULT 'checking',
  source_account_id VARCHAR,
  notes             VARCHAR,
  created_at        TIMESTAMP DEFAULT now()
);
