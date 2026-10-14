// Sắp xếp các điểm trong ngày theo tuyến gần nhau nhất (nearest-neighbor) để
// đỡ di chuyển lòng vòng. Điểm thiếu toạ độ giữ nguyên ở cuối.

import { travelMatrix } from './mapbox';

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

// Tối ưu theo THỜI GIAN LÁI XE THẬT (Mapbox Matrix). Điểm đầu giữ cố định (điểm
// xuất phát trong ngày), điểm cuối tự do. ≤9 điểm: vét cạn → tối ưu tuyệt đối;
// nhiều hơn: láng giềng gần nhất + 2-opt. Lỗi mạng/API → lùi về optimizeOrder.
export async function optimizeOrderByRoad<T extends GeoPoint>(
  items: T[],
  matrix: typeof travelMatrix = travelMatrix,
): Promise<number[]> {
  const has = (it: GeoPoint) => it.lat != null && it.lon != null;
  const located = items.map((_, i) => i).filter((i) => has(items[i]));
  const rest = items.map((_, i) => i).filter((i) => !has(items[i]));
  if (located.length <= 2 || located.length > 25) return optimizeOrder(items);

  let durations: (number | null)[][];
  try {
    durations = await matrix(
      located.map((i) => ({ lat: items[i].lat as number, lon: items[i].lon as number })),
    );
  } catch (e) {
    console.warn('[optimize] matrix failed, fallback straight-line:', e);
    return optimizeOrder(items);
  }

  const n = located.length;
  const NO_ROUTE = 1e7; // không có đường → phạt rất nặng
  const cost = (a: number, b: number) => durations[a]?.[b] ?? NO_ROUTE;
  const pathCost = (p: number[]) => {
    let s = 0;
    for (let k = 0; k + 1 < p.length; k++) s += cost(p[k], p[k + 1]);
    return s;
  };

  let best: number[];
  if (n <= 9) {
    // Vét cạn có cắt nhánh (branch & bound), điểm 0 cố định.
    let bestCost = Infinity;
    best = [];
    const used = new Array(n).fill(false);
    used[0] = true;
    const cur = [0];
    const dfs = (acc: number) => {
      if (acc >= bestCost) return;
      if (cur.length === n) { bestCost = acc; best = [...cur]; return; }
      const last = cur[cur.length - 1];
      for (let j = 1; j < n; j++) {
        if (used[j]) continue;
        used[j] = true; cur.push(j);
        dfs(acc + cost(last, j));
        cur.pop(); used[j] = false;
      }
    };
    dfs(0);
  } else {
    // Láng giềng gần nhất…
    best = [0];
    const left = new Set(Array.from({ length: n - 1 }, (_, k) => k + 1));
    while (left.size) {
      const last = best[best.length - 1];
      let pick = -1;
      for (const j of left) if (pick < 0 || cost(last, j) < cost(last, pick)) pick = j;
      best.push(pick); left.delete(pick);
    }
    // …rồi 2-opt (đảo đoạn) tới khi không cải thiện được nữa.
    let improved = true;
    let bestCost = pathCost(best);
    while (improved) {
      improved = false;
      for (let a = 1; a < n - 1; a++) {
        for (let b = a + 1; b < n; b++) {
          const cand = [...best.slice(0, a), ...best.slice(a, b + 1).reverse(), ...best.slice(b + 1)];
          const c = pathCost(cand);
          if (c < bestCost) { best = cand; bestCost = c; improved = true; }
        }
      }
    }
  }

  return [...best.map((k) => located[k]), ...rest];
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
