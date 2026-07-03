-- Lưu toạ độ địa điểm của hoạt động (chọn từ ô tìm kiếm) → bản đồ/chỉ đường
-- chính xác, không phải geocode lại chuỗi địa chỉ mỗi lần.
ALTER TABLE activities ADD COLUMN IF NOT EXISTS lat double precision;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS lon double precision;
