-- Bật Realtime (logical replication) cho các bảng cộng tác → thành viên thấy
-- thay đổi của nhau ngay. Bỏ qua nếu bảng đã có trong publication.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['activities','trip_expenses','trip_funds','trip_fund_payments'] LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I', t);
    EXCEPTION WHEN others THEN NULL; -- đã có rồi → bỏ qua
    END;
  END LOOP;
END $$;
