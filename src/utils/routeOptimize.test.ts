import { describe, it, expect } from 'vitest';
import { optimizeOrder, totalDistanceKm } from './routeOptimize';

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
