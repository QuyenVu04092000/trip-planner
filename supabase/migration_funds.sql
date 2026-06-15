-- Trip funds (thu quỹ)
CREATE TABLE IF NOT EXISTS trip_funds (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  description TEXT NOT NULL DEFAULT 'Quỹ chuyến đi',
  amount_per_person NUMERIC(12, 0) NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE trip_funds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "trip_funds_select" ON trip_funds
  FOR SELECT USING (trip_id IN (SELECT get_my_trip_ids()));

CREATE POLICY "trip_funds_insert" ON trip_funds
  FOR INSERT WITH CHECK (trip_id IN (SELECT get_my_trip_ids()));

CREATE POLICY "trip_funds_delete" ON trip_funds
  FOR DELETE USING (created_by = auth.uid()::text OR is_trip_owner(trip_id));

-- Fund payment status per member
CREATE TABLE IF NOT EXISTS trip_fund_payments (
  id TEXT PRIMARY KEY,
  fund_id TEXT NOT NULL REFERENCES trip_funds(id) ON DELETE CASCADE,
  trip_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_email TEXT NOT NULL,
  paid BOOLEAN DEFAULT FALSE,
  paid_at TIMESTAMPTZ,
  UNIQUE(fund_id, user_id)
);

ALTER TABLE trip_fund_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "trip_fund_payments_select" ON trip_fund_payments
  FOR SELECT USING (trip_id IN (SELECT get_my_trip_ids()));

CREATE POLICY "trip_fund_payments_insert" ON trip_fund_payments
  FOR INSERT WITH CHECK (trip_id IN (SELECT get_my_trip_ids()));

-- Members can toggle their own; owner can toggle anyone
CREATE POLICY "trip_fund_payments_update" ON trip_fund_payments
  FOR UPDATE USING (
    user_id = auth.uid()::text OR is_trip_owner(trip_id)
  );

CREATE POLICY "trip_fund_payments_delete" ON trip_fund_payments
  FOR DELETE USING (is_trip_owner(trip_id));
