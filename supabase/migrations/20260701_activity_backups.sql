-- Địa chỉ dự phòng cho mỗi hoạt động (mảng { address, lat, lon }).
ALTER TABLE activities ADD COLUMN IF NOT EXISTS backups jsonb NOT NULL DEFAULT '[]'::jsonb;
