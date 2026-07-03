-- Lưu toạ độ điểm đến của chuyến đi (chọn từ bản đồ) → thời tiết & các tính năng
-- cần vị trí dùng luôn, khỏi geocode lại chuỗi địa chỉ.
ALTER TABLE trips ADD COLUMN IF NOT EXISTS lat double precision;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS lon double precision;
