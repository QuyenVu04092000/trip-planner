import { api } from './api';

// Tìm/geocode địa điểm qua Google Places (proxy ở edge function `places`, toàn cầu).
// Thay vai trò Mapbox trước đây: dữ liệu + toạ độ là của Google → khớp Google Maps.

export interface PlaceSuggestion {
  placeId: string;
  mainText: string;      // tên địa điểm
  secondaryText: string; // địa chỉ phụ
}

export interface PlaceDetail {
  placeId: string;
  name: string;
  address: string;
  lat: number | null;
  lon: number | null;
}

// Token phiên cho Autocomplete (gộp autocomplete + details thành 1 session billing).
// Tạo 1 token mỗi lần mở ô tìm; sau khi chọn xong nên tạo token mới cho lần sau.
export function newSessionToken(): string {
  return crypto.randomUUID();
}

export async function suggestPlaces(q: string, session: string): Promise<PlaceSuggestion[]> {
  if (q.trim().length < 2) return [];
  const { items } = await api.get<{ items: PlaceSuggestion[] }>('/places', {
    op: 'autocomplete',
    q,
    session,
  });
  return items ?? [];
}

export async function getPlaceDetails(placeId: string, session: string): Promise<PlaceDetail> {
  return api.get<PlaceDetail>('/places', { op: 'details', placeId, session });
}

export async function forwardGeocode(q: string): Promise<{ lat: number | null; lon: number | null; address: string }> {
  return api.get<{ lat: number | null; lon: number | null; address: string }>('/places', {
    op: 'geocode',
    q,
  });
}

export async function reverseGeocode(lat: number, lon: number): Promise<{ address: string; placeId: string | null }> {
  return api.get<{ address: string; placeId: string | null }>('/places', {
    op: 'reverse',
    lat: String(lat),
    lon: String(lon),
  });
}
