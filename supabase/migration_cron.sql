-- Setup pg_cron for TripMemo push notifications
-- Chạy file này trong Supabase SQL Editor
--
-- Yêu cầu: pg_cron và pg_net extension phải được bật
-- (Dashboard → Database → Extensions → tìm "pg_cron" và "pg_net" → Enable)

-- Bước 1: Bật extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Bước 2: Thay <SERVICE_ROLE_KEY> bằng key thật
-- (Dashboard → Project Settings → API → service_role key)

-- ── Nhắc ngày đi: mỗi ngày lúc 00:00 giờ Việt Nam (= 17:00 UTC) ─────────────
SELECT cron.schedule(
  'trip-day-reminders',          -- tên job (unique)
  '0 17 * * *',                  -- 17:00 UTC = 00:00 VN (UTC+7)
  $$
    SELECT net.http_get(
      url     := 'https://ykrxbyvjxmnqvqawlwyx.supabase.co/functions/v1/trip-push-notify',
      headers := jsonb_build_object(
        'Authorization', 'Bearer <SERVICE_ROLE_KEY>',
        'Content-Type',  'application/json'
      )
    )
  $$
);

-- ── Nhắc hoạt động: mỗi 5 phút ──────────────────────────────────────────────
SELECT cron.schedule(
  'activity-reminders',          -- tên job (unique)
  '*/5 * * * *',                 -- mỗi 5 phút
  $$
    SELECT net.http_get(
      url     := 'https://ykrxbyvjxmnqvqawlwyx.supabase.co/functions/v1/send-activity-reminders',
      headers := jsonb_build_object(
        'Authorization', 'Bearer <SERVICE_ROLE_KEY>',
        'Content-Type',  'application/json'
      )
    )
  $$
);

-- ── Kiểm tra jobs đã tạo ─────────────────────────────────────────────────────
SELECT jobname, schedule, active FROM cron.job ORDER BY jobid;

-- ── Xoá job nếu cần chỉnh lại ────────────────────────────────────────────────
-- SELECT cron.unschedule('trip-day-reminders');
-- SELECT cron.unschedule('activity-reminders');
