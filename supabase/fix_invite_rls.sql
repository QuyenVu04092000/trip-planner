-- Fix: accept_trip_invite function (SECURITY DEFINER bypasses RLS for INSERT)
-- Chạy file này trong Supabase SQL Editor

-- Hàm này chạy với quyền postgres (SECURITY DEFINER), bỏ qua RLS
-- Nhưng vẫn kiểm tra auth bên trong để đảm bảo an toàn
CREATE OR REPLACE FUNCTION accept_trip_invite(
  p_trip_id    text,
  p_user_id    text,
  p_user_email text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF auth.uid()::text != p_user_id THEN
    RAISE EXCEPTION 'Can only add yourself as a trip member';
  END IF;

  INSERT INTO trip_members (id, trip_id, user_id, user_email, role, joined_at)
  VALUES (
    'mem_' || floor(extract(epoch from now()) * 1000)::text
             || '_' || substr(md5(random()::text), 1, 8),
    p_trip_id,
    p_user_id::uuid,
    p_user_email,
    'member',
    now()
  )
  ON CONFLICT (trip_id, user_id) DO NOTHING;
END;
$$;

-- Cho phép user đã đăng nhập gọi hàm này
GRANT EXECUTE ON FUNCTION accept_trip_invite(text, text, text) TO authenticated;
