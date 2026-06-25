-- Gỡ bảng device_push_tokens (native FCM push) — không còn dùng nữa.
-- Native push đã bị loại bỏ; chỉ còn web push qua push_subscriptions.
DROP TABLE IF EXISTS device_push_tokens;
