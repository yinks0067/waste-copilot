-- Project B: Markdown & Waste Copilot (PostgreSQL)
DROP TABLE IF EXISTS batches, daily, products CASCADE;

CREATE TABLE products (
  sku              TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  category         TEXT NOT NULL,
  unit_cost        NUMERIC(8,2) NOT NULL,  -- GBP
  unit_price       NUMERIC(8,2) NOT NULL,  -- GBP
  shelf_life_days  INT NOT NULL
);

-- One row per product per trading day
CREATE TABLE daily (
  sku             TEXT NOT NULL REFERENCES products(sku),
  day             INT  NOT NULL,
  delivered       INT  NOT NULL,
  wasted          INT  NOT NULL,           -- binned at end of use-by day
  sold_full       INT  NOT NULL,
  sold_reduced    INT  NOT NULL,
  revenue         NUMERIC(10,2) NOT NULL,
  markdown_given  NUMERIC(10,2) NOT NULL,  -- £ given away in reductions
  PRIMARY KEY (sku, day)
);

-- What is on the shelf this morning, by batch
CREATE TABLE batches (
  batch_id      TEXT PRIMARY KEY,
  sku           TEXT NOT NULL REFERENCES products(sku),
  received_day  INT  NOT NULL,
  expiry_day    INT  NOT NULL,
  qty           INT  NOT NULL
);

CREATE INDEX ON daily (day);
CREATE INDEX ON batches (sku);
