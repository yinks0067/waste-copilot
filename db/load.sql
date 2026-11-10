-- Run from the project root:  psql "$DATABASE_URL" -f db/schema.sql -f db/load.sql
\copy products (sku, name, category, unit_cost, unit_price, shelf_life_days) FROM 'data/products.csv' WITH (FORMAT csv, HEADER true)
\copy daily (sku, day, delivered, wasted, sold_full, sold_reduced, revenue, markdown_given) FROM 'data/daily.csv' WITH (FORMAT csv, HEADER true)
\copy batches (batch_id, sku, received_day, expiry_day, qty) FROM 'data/batches.csv' WITH (FORMAT csv, HEADER true)
