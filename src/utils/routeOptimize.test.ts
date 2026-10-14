import { describe, it, expect } from 'vitest';
import { optimizeOrder, optimizeOrderByRoad, totalDistanceKm } from './routeOptimize';

// Toạ độ giả lập trên 1 đường thẳng: 0, 3, 1, 2 (cố tình xáo trộn)
const pts = [
  { lat: 0, lon: 0 },   // 0
  { lat: 0, lon: 3 },   // 1 (xa)
  { lat: 0, lon: 1 },   // 2
  { lat: 0, lon: 2 },   // 3
];

describe('optimizeOrder', () => {
  it('sắp xếp nearest-neighbor từ điểm đầu → 0,2,3,1', () => {
    expect(optimizeOrder(pts)).toEqual([0, 2, 3, 1]);
  });

  it('thứ tự tối ưu có tổng quãng đường ≤ thứ tự gốc', () => {
    const order = optimizeOrder(pts);
    const optimized = order.map((i) => pts[i]);
    expect(totalDistanceKm(optimized)).toBeLessThanOrEqual(totalDistanceKm(pts));
  });

  it('điểm thiếu toạ độ được đẩy xuống cuối', () => {
    const mixed = [{ lat: 0, lon: 0 }, { lat: null, lon: null }, { lat: 0, lon: 1 }, { lat: 0, lon: 2 }];
    const order = optimizeOrder(mixed);
    expect(order[order.length - 1]).toBe(1); // index 1 (no coords) ở cuối
  });

  it('≤ 2 điểm thì giữ nguyên', () => {
    expect(optimizeOrder([{ lat: 0, lon: 0 }, { lat: 0, lon: 9 }])).toEqual([0, 1]);
  });
});

describe('optimizeOrderByRoad', () => {
  // 4 điểm; theo đường chim bay thứ tự tối ưu là 0,2,3,1 nhưng ma trận giả nói
  // 0→1 rất nhanh (VD có cao tốc) → tối ưu theo đường thật phải là 0,1,3,2.
  const fast = (a: number, b: number) =>
    ({ '0-1': 60, '1-3': 60, '3-2': 60 } as Record<string, number>)[`${a}-${b}`] ?? 1000;
  const matrix = async (p: { lat: number; lon: number }[]) =>
    p.map((_, a) => p.map((_, b) => (a === b ? 0 : fast(a, b))));

  it('dùng thời gian lái xe thật, giữ điểm đầu cố định', async () => {
    expect(await optimizeOrderByRoad(pts, matrix)).toEqual([0, 1, 3, 2]);
  });

  it('điểm thiếu toạ độ để cuối, giữ nguyên thứ tự', async () => {
    const items = [...pts, { lat: null, lon: null }];
    expect(await optimizeOrderByRoad(items, matrix)).toEqual([0, 1, 3, 2, 4]);
  });

  it('API lỗi → lùi về đường chim bay', async () => {
    const broken = async () => { throw new Error('offline'); };
    expect(await optimizeOrderByRoad(pts, broken)).toEqual([0, 2, 3, 1]);
  });

  it('>9 điểm (NN + 2-opt) vẫn ra hoán vị hợp lệ bắt đầu từ 0', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ lat: 0, lon: (i * 7) % 12 }));
    const line = async (p: { lat: number; lon: number }[]) =>
      p.map((a) => p.map((b) => Math.abs(a.lon - b.lon) * 60));
    const order = await optimizeOrderByRoad(many, line);
    expect(order[0]).toBe(0);
    expect([...order].sort((x, y) => x - y)).toEqual(many.map((_, i) => i));
    // Trên 1 đường thẳng, xuất phát từ lon=0 → đi theo lon tăng dần.
    expect(order.map((i) => many[i].lon)).toEqual(many.map((_, i) => i));
  });
});
