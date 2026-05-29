-- ═══════════════════════════════════════════════════════════════════════════
-- Row Level Security: mỗi user chỉ thấy & chỉnh sửa data của chính họ
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. TRIPS ────────────────────────────────────────────────────────────────
ALTER TABLE trips ENABLE ROW LEVEL SECURITY;

-- Xóa policy cũ nếu có
DROP POLICY IF EXISTS "Users manage own trips" ON trips;

CREATE POLICY "Users manage own trips" ON trips
  FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- ── 2. ACTIVITIES ────────────────────────────────────────────────────────────
-- activities không có user_id trực tiếp → join qua trips
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own activities" ON activities;

CREATE POLICY "Users manage own activities" ON activities
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM trips
      WHERE trips.id = activities.trip_id
        AND trips.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM trips
      WHERE trips.id = activities.trip_id
        AND trips.user_id = auth.uid()
    )
  );


-- ── 3. MEDIA_ITEMS ───────────────────────────────────────────────────────────
-- media_items cũng join qua trips
ALTER TABLE media_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own media" ON media_items;

CREATE POLICY "Users manage own media" ON media_items
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM trips
      WHERE trips.id = media_items.trip_id
        AND trips.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM trips
      WHERE trips.id = media_items.trip_id
        AND trips.user_id = auth.uid()
    )
  );
