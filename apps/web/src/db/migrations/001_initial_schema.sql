-- Migration tracking
CREATE TABLE IF NOT EXISTS __migrations (
  name       VARCHAR PRIMARY KEY,
  applied_at TIMESTAMP DEFAULT now()
);

-- Categories
CREATE TABLE IF NOT EXISTS categories (
  id         VARCHAR PRIMARY KEY,
  name       VARCHAR NOT NULL,
  type       VARCHAR NOT NULL CHECK (type IN ('expense', 'income')),
  color      VARCHAR DEFAULT '#6366f1',
  icon       VARCHAR DEFAULT 'tag',
  created_at TIMESTAMP DEFAULT now()
);

INSERT OR IGNORE INTO categories VALUES
  ('cat-groceries',    'Groceries',      'expense', '#22c55e',  'shopping-cart', now()),
  ('cat-dining',       'Dining Out',     'expense', '#f59e0b',  'utensils',      now()),
  ('cat-transport',    'Transportation', 'expense', '#3b82f6',  'car',           now()),
  ('cat-housing',      'Housing',        'expense', '#9333ea',  'home',          now()),
  ('cat-utilities',    'Utilities',      'expense', '#ef4444',  'zap',           now()),
  ('cat-healthcare',   'Healthcare',     'expense', '#14b8a6',  'heart',         now()),
  ('cat-entertainment','Entertainment',  'expense', '#ec4899',  'tv',            now()),
  ('cat-subscriptions','Subscriptions',  'expense', '#8b5cf6',  'repeat',        now()),
  ('cat-shopping',     'Shopping',       'expense', '#f97316',  'bag',           now()),
  ('cat-other',        'Other',          'expense', '#94a3b8',  'more-horizontal',now()),
  ('cat-income',       'Salary/Income',  'income',  '#22c55e',  'dollar-sign',   now()),
  ('cat-savings',      'Savings',        'income',  '#6366f1',  'piggy-bank',    now());

-- Expenses
CREATE TABLE IF NOT EXISTS expenses (
  id           VARCHAR PRIMARY KEY,
  amount       DECIMAL(12,2) NOT NULL CHECK (amount > 0),
  description  VARCHAR NOT NULL,
  category_id  VARCHAR NOT NULL,
  expense_date DATE NOT NULL,
  week_start   DATE NOT NULL,
  notes        VARCHAR,
  created_at   TIMESTAMP DEFAULT now(),
  updated_at   TIMESTAMP DEFAULT now()
);

-- Debts
CREATE TABLE IF NOT EXISTS debts (
  id               VARCHAR PRIMARY KEY,
  name             VARCHAR NOT NULL,
  debt_type        VARCHAR NOT NULL DEFAULT 'other',
  current_balance  DECIMAL(12,2) NOT NULL CHECK (current_balance >= 0),
  original_balance DECIMAL(12,2) NOT NULL,
  interest_rate    DECIMAL(6,4) NOT NULL CHECK (interest_rate >= 0),
  minimum_payment  DECIMAL(12,2) NOT NULL CHECK (minimum_payment >= 0),
  due_day          INTEGER,
  is_active        BOOLEAN DEFAULT true,
  created_at       TIMESTAMP DEFAULT now(),
  updated_at       TIMESTAMP DEFAULT now()
);

-- Debt payment history
CREATE TABLE IF NOT EXISTS debt_payments (
  id             VARCHAR PRIMARY KEY,
  debt_id        VARCHAR NOT NULL,
  payment_amount DECIMAL(12,2) NOT NULL CHECK (payment_amount > 0),
  payment_date   DATE NOT NULL,
  principal_paid DECIMAL(12,2),
  interest_paid  DECIMAL(12,2),
  notes          VARCHAR,
  created_at     TIMESTAMP DEFAULT now()
);

-- Investments
CREATE TABLE IF NOT EXISTS investments (
  id                   VARCHAR PRIMARY KEY,
  name                 VARCHAR NOT NULL,
  account_type         VARCHAR NOT NULL DEFAULT 'other',
  institution          VARCHAR,
  current_value        DECIMAL(12,2) NOT NULL DEFAULT 0,
  cost_basis           DECIMAL(12,2) DEFAULT 0,
  monthly_contribution DECIMAL(12,2) DEFAULT 0,
  expected_return      DECIMAL(6,4) DEFAULT 0.07,
  is_active            BOOLEAN DEFAULT true,
  created_at           TIMESTAMP DEFAULT now(),
  updated_at           TIMESTAMP DEFAULT now()
);

-- Investment value snapshots
CREATE TABLE IF NOT EXISTS investment_snapshots (
  id            VARCHAR PRIMARY KEY,
  investment_id VARCHAR NOT NULL,
  snapshot_date DATE NOT NULL,
  value         DECIMAL(12,2) NOT NULL,
  contribution  DECIMAL(12,2) DEFAULT 0,
  created_at    TIMESTAMP DEFAULT now()
);

-- Budget targets
CREATE TABLE IF NOT EXISTS budget_targets (
  id            VARCHAR PRIMARY KEY,
  category_id   VARCHAR NOT NULL,
  month         DATE NOT NULL,
  target_amount DECIMAL(12,2) NOT NULL,
  created_at    TIMESTAMP DEFAULT now()
);

-- Net worth snapshots
CREATE TABLE IF NOT EXISTS net_worth_snapshots (
  id            VARCHAR PRIMARY KEY,
  snapshot_date DATE NOT NULL UNIQUE,
  total_assets  DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_debts   DECIMAL(12,2) NOT NULL DEFAULT 0,
  created_at    TIMESTAMP DEFAULT now()
);
