-- Migration: trip_expenses table
-- Quản lý chi tiêu chung trong chuyến đi, chia đầu người tự động

CREATE TABLE IF NOT EXISTS trip_expenses (
  id          TEXT PRIMARY KEY,
  trip_id     TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  amount      NUMERIC(12, 0) NOT NULL,
  paid_by     TEXT NOT NULL,        -- user_id người trả
  paid_by_email TEXT NOT NULL,
  splits      JSONB NOT NULL DEFAULT '[]', -- [{userId, email, amount}]
  date        TEXT,                 -- YYYY-MM-DD (optional)
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE trip_expenses ENABLE ROW LEVEL SECURITY;

-- Members của trip mới thấy được chi tiêu
CREATE POLICY "trip_expenses_select" ON trip_expenses FOR SELECT
  USING (trip_id IN (SELECT get_my_trip_ids()));

-- Members có thể thêm chi tiêu
CREATE POLICY "trip_expenses_insert" ON trip_expenses FOR INSERT
  WITH CHECK (trip_id IN (SELECT get_my_trip_ids()));

-- Người tạo hoặc owner có thể xoá
CREATE POLICY "trip_expenses_delete" ON trip_expenses FOR DELETE
  USING (paid_by = auth.uid()::text OR is_trip_owner(trip_id));

-- Update: người tạo hoặc owner
CREATE POLICY "trip_expenses_update" ON trip_expenses FOR UPDATE
  USING (paid_by = auth.uid()::text OR is_trip_owner(trip_id));
