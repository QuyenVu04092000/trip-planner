-- Migration: user_profiles
-- Lưu tên hiển thị của người dùng, dùng chung cho tất cả chuyến đi

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id     TEXT PRIMARY KEY,
  display_name TEXT NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Ai cũng đọc được (cần để hiện tên trong trip)
CREATE POLICY "profiles_select" ON user_profiles
  FOR SELECT USING (true);

-- Chỉ tự insert profile của mình
CREATE POLICY "profiles_insert" ON user_profiles
  FOR INSERT WITH CHECK (user_id = auth.uid()::text);

-- Chỉ tự update profile của mình
CREATE POLICY "profiles_update" ON user_profiles
  FOR UPDATE USING (user_id = auth.uid()::text);
