// Sắp xếp các điểm trong ngày theo tuyến gần nhau nhất (nearest-neighbor) để
// đỡ di chuyển lòng vòng. Điểm thiếu toạ độ giữ nguyên ở cuối.

export interface GeoPoint {
  lat?: number | null;
  lon?: number | null;
}

function km(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Trả về thứ tự index tối ưu. Bắt đầu từ điểm đầu tiên (thường là điểm sáng/khởi hành).
export function optimizeOrder<T extends GeoPoint>(items: T[]): number[] {
  const has = (it: GeoPoint) => it.lat != null && it.lon != null;
  const located = items
    .map((it, i) => ({ i, lat: it.lat as number, lon: it.lon as number }))
    .filter((p) => has(items[p.i]));
  const rest = items.map((_, i) => i).filter((i) => !has(items[i]));

  if (located.length <= 2) return [...located.map((p) => p.i), ...rest];

  const order: number[] = [];
  const remaining = [...located];
  let cur = remaining.shift()!;
  order.push(cur.i);
  while (remaining.length) {
    let best = 0;
    let bestD = Infinity;
    for (let k = 0; k < remaining.length; k++) {
      const d = km(cur.lat, cur.lon, remaining[k].lat, remaining[k].lon);
      if (d < bestD) { bestD = d; best = k; }
    }
    cur = remaining.splice(best, 1)[0];
    order.push(cur.i);
  }
  return [...order, ...rest];
}

// Tổng quãng đường (km) của một thứ tự điểm — để so sánh trước/sau tối ưu.
export function totalDistanceKm<T extends GeoPoint>(items: T[]): number {
  let sum = 0;
  let prev: GeoPoint | null = null;
  for (const it of items) {
    if (it.lat == null || it.lon == null) continue;
    if (prev) sum += km(prev.lat as number, prev.lon as number, it.lat, it.lon);
    prev = it;
  }
  return sum;
}
