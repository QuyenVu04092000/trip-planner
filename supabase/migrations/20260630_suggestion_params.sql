-- Cache gợi ý phải vô hiệu khi đổi điểm đến / tuỳ chọn cá nhân hoá.
-- `params` lưu khoá JSON (destination + companions + interests + budget);
-- đọc cache chỉ dùng khi params khớp. Hàng cũ (params null) tự miss → sinh lại.
ALTER TABLE trip_suggestions ADD COLUMN IF NOT EXISTS params text;
