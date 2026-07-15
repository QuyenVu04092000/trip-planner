import { Capacitor } from '@capacitor/core';
import { AppLauncher } from '@capacitor/app-launcher';

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
  if (Capacitor.isNativePlatform()) {
    // AppLauncher → UIApplication.open: iOS route universal link sang app
    // Google Maps (nếu cài) hoặc Safari. window.open('_system') là quy ước
    // Cordova, không đảm bảo trong WKWebView.
    void AppLauncher.openUrl({ url }).catch(() => {
      window.open(url, '_blank');
    });
    return;
  }
  window.open(url, '_blank');
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
