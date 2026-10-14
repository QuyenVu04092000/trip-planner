-- Biểu tượng chuyến đi tự tải lên: ảnh vuông 256px dạng data URL (~20–40KB).
-- NULL = dùng emoji như cũ. Màu bìa tự chọn lưu luôn ở cover_color dạng "#rrggbb".
ALTER TABLE trips ADD COLUMN IF NOT EXISTS icon_image text;
