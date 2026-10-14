// Mapbox (không phụ thuộc billing Google): chỉ đường, ma trận thời gian, geocode,
// và các hàm hình học nhỏ dùng cho dẫn đường trong app.

export const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string;

export interface LatLon {
  lat: number;
  lon: number;
}

export interface RouteStep {
  instruction: string; // tiếng Việt, VD "Rẽ phải trên Phố Tràng Thi."
  type: string;        // maneuver.type: depart | turn | arrive | roundabout | …
  modifier: string;    // left | slight right | uturn | … ("" nếu không có)
  at: LatLon;          // chỗ thực hiện thao tác (đầu bước)
  distance: number;    // m — quãng đường của bước này (sau thao tác)
  duration: number;    // giây
}

export interface Route {
  path: LatLon[];
  distance: number;
  duration: number;
  legs: { steps: RouteStep[] }[]; // 1 chặng giữa 2 điểm liên tiếp
}

const coordStr = (pts: LatLon[]) => pts.map((p) => `${p.lon},${p.lat}`).join(";");

// Mapbox Directions — tuyến lái xe thật (có tính kẹt xe), tối đa 25 điểm.
export async function getRoute(points: LatLon[]): Promise<Route | null> {
  if (points.length < 2) return null;
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${coordStr(points)}` +
    `?access_token=${MAPBOX_TOKEN}&steps=true&geometries=geojson&overview=full&language=vi`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`directions HTTP ${res.status}`);
  const data = await res.json();
  const r = data.routes?.[0];
  if (!r) return null;
  return {
    path: (r.geometry.coordinates as [number, number][]).map(([lon, lat]) => ({ lat, lon })),
    distance: r.distance,
    duration: r.duration,
    legs: (r.legs ?? []).map((leg: { steps?: MapboxStep[] }) => ({
      steps: (leg.steps ?? []).map((s) => ({
        instruction: s.maneuver.instruction ?? "",
        type: s.maneuver.type ?? "",
        modifier: s.maneuver.modifier ?? "",
        at: { lon: s.maneuver.location[0], lat: s.maneuver.location[1] },
        distance: s.distance ?? 0,
        duration: s.duration ?? 0,
      })),
    })),
  };
}

interface MapboxStep {
  distance?: number;
  duration?: number;
  maneuver: { instruction?: string; type?: string; modifier?: string; location: [number, number] };
}

// Mapbox Matrix — thời gian lái xe (giây) giữa mọi cặp điểm, tối đa 25 điểm.
// null = không có đường.
export async function travelMatrix(points: LatLon[]): Promise<(number | null)[][]> {
  const url =
    `https://api.mapbox.com/directions-matrix/v1/mapbox/driving/${coordStr(points)}` +
    `?access_token=${MAPBOX_TOKEN}&annotations=duration`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`matrix HTTP ${res.status}`);
  const data = await res.json();
  if (data.code !== "Ok" || !Array.isArray(data.durations)) throw new Error(`matrix ${data.code}`);
  return data.durations;
}

// Mapbox Geocoding — địa chỉ (chữ) → toạ độ. Đúng với địa chỉ đầy đủ; tên ngắn có
// thể lệch nên luôn ưu tiên toạ độ đã lưu.
export async function forwardGeocode(address: string): Promise<LatLon | null> {
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json?access_token=${MAPBOX_TOKEN}&language=vi&limit=1`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const f = data.features?.[0];
  if (!f) return null;
  return { lon: f.center[0], lat: f.center[1] };
}

// Khoảng cách (m) giữa 2 điểm — haversine.
export function meters(a: LatLon, b: LatLon): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Khoảng cách (m) từ điểm p tới tuyến — xấp xỉ phẳng cục bộ, đủ chính xác để phát
// hiện "đi lệch tuyến" vài chục mét.
export function distanceToPath(p: LatLon, path: LatLon[]): number {
  if (path.length === 0) return Infinity;
  if (path.length === 1) return meters(p, path[0]);
  const kx = 111320 * Math.cos((p.lat * Math.PI) / 180);
  const ky = 110540;
  let min = Infinity;
  for (let i = 0; i + 1 < path.length; i++) {
    const ax = (path[i].lon - p.lon) * kx;
    const ay = (path[i].lat - p.lat) * ky;
    const bx = (path[i + 1].lon - p.lon) * kx;
    const by = (path[i + 1].lat - p.lat) * ky;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < min) min = d;
  }
  return min;
}

export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}

export function formatDuration(sec: number): string {
  const min = Math.round(sec / 60);
  if (min < 60) return `${Math.max(1, min)} phút`;
  return `${Math.floor(min / 60)} giờ ${min % 60} phút`;
}
