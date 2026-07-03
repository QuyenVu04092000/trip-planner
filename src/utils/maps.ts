import { Capacitor } from '@capacitor/core';

// Mở Google Maps bằng deep-link (KHÔNG cần API key). Ưu tiên toạ độ lat/lon để
// trỏ đúng vị trí; không có thì dùng địa chỉ/tên. Google Maps tự lấy vị trí hiện
// tại làm điểm xuất phát khi chỉ đường.

interface Place {
  lat?: number | null;
  lon?: number | null;
  address?: string;
  name?: string;
}

function openExternal(url: string): void {
  // Native: mở app ngoài (Google Maps/Safari); Web: tab mới
  window.open(url, Capacitor.isNativePlatform() ? '_system' : '_blank');
}

// Chỉ đường từ vị trí hiện tại → địa điểm
export function openDirections(p: Place): void {
  const dest =
    p.lat != null && p.lon != null ? `${p.lat},${p.lon}` : (p.address || p.name || '');
  openExternal(
    `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}&travelmode=driving`,
  );
}

// Xem địa điểm trên Google Maps
export function openPlace(p: Place): void {
  const q =
    p.lat != null && p.lon != null
      ? `${p.lat},${p.lon}`
      : `${p.name ?? ''} ${p.address ?? ''}`.trim();
  openExternal(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`);
}
