-- ═══════════════════════════════════════════════════════════════════════════
-- Cache gợi ý địa điểm cho mỗi chuyến đi (tránh gọi Gemini/Mapbox lặp lại)
-- Mỗi user cache riêng theo (trip_id, created_by) → RLS đơn giản, không join
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS trip_suggestions (
  trip_id    text        NOT NULL,
  created_by uuid        NOT NULL DEFAULT auth.uid(),
  data       jsonb       NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (trip_id, created_by)
);

ALTER TABLE trip_suggestions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own suggestions" ON trip_suggestions;

CREATE POLICY "own suggestions" ON trip_suggestions
  FOR ALL
  USING      (auth.uid() = created_by)
  WITH CHECK (auth.uid() = created_by);
