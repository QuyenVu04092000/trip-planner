-- Giới hạn số lần gọi AI (Gemini) mỗi user/ngày → chặn spam đốt quota.
CREATE TABLE IF NOT EXISTS ai_usage (
  user_id uuid NOT NULL DEFAULT auth.uid(),
  day     date NOT NULL DEFAULT current_date,
  count   int  NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own ai usage" ON ai_usage;
CREATE POLICY "own ai usage" ON ai_usage
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Tăng đếm cho hôm nay (atomic) và trả về CÓ còn trong hạn mức không.
CREATE OR REPLACE FUNCTION check_ai_quota(p_limit int)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE cur int;
BEGIN
  INSERT INTO ai_usage (user_id, day, count)
    VALUES (auth.uid(), current_date, 1)
  ON CONFLICT (user_id, day)
    DO UPDATE SET count = ai_usage.count + 1
  RETURNING count INTO cur;
  RETURN cur <= p_limit;
END;
$$;
