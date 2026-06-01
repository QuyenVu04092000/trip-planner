-- Fix: infinite recursion giữa trips ↔ trip_members RLS policies
-- Nguyên nhân: trips policy → query trip_members (có RLS)
--              trip_members policy → query trips (có RLS) → vòng lặp

-- Bước 1: Xoá các policies bị conflict
DROP POLICY IF EXISTS "trip_members_select"  ON trip_members;
DROP POLICY IF EXISTS "trips_member_select"  ON trips;
DROP POLICY IF EXISTS "trip_members_delete"  ON trip_members;

-- Bước 2: Tạo SECURITY DEFINER functions
-- (chạy với quyền DB owner, bypass RLS → không bị recursion)

CREATE OR REPLACE FUNCTION get_my_trip_ids()
RETURNS SETOF text
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT trip_id FROM trip_members WHERE user_id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION is_trip_owner(p_trip_id text)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM trips WHERE id = p_trip_id AND user_id = auth.uid()
  )
$$;

-- Bước 3: Tạo lại policies dùng functions (không còn circular)

-- trips: thấy trip mình là member
CREATE POLICY "trips_member_select" ON trips FOR SELECT
  USING (id IN (SELECT get_my_trip_ids()));

-- trip_members: thấy members của trip mình thuộc
CREATE POLICY "trip_members_select" ON trip_members FOR SELECT
  USING (trip_id IN (SELECT get_my_trip_ids()));

-- trip_members: tự rời hoặc owner xoá member
CREATE POLICY "trip_members_delete" ON trip_members FOR DELETE
  USING (user_id = auth.uid() OR is_trip_owner(trip_id));
