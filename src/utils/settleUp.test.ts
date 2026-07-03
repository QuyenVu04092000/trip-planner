import { describe, it, expect } from 'vitest';
import { computeBalances, settleUp, computeSettlement } from './settleUp';
import type { TripExpense, TripMember } from '../types';

function member(userId: string, name: string): TripMember {
  return { id: userId, tripId: 't', userId, userEmail: `${name}@x.com`, displayName: name, role: 'member', joinedAt: '' };
}
function expense(paidBy: string, amount: number, splits: [string, number][], fundId: string | null = null): TripExpense {
  return {
    id: Math.random().toString(36), tripId: 't', description: 'x', amount, paidBy,
    paidByEmail: '', splits: splits.map(([userId, a]) => ({ userId, email: '', amount: a })),
    date: '', createdAt: '', fundId,
  };
}

const A = member('a', 'An');
const B = member('b', 'Bình');
const C = member('c', 'Châu');

describe('computeBalances', () => {
  it('A trả 300k chia đều 3 người → A +200, B/C -100', () => {
    const bal = computeBalances([expense('a', 300_000, [['a', 100_000], ['b', 100_000], ['c', 100_000]])], [A, B, C]);
    expect(bal.find(b => b.userId === 'a')!.net).toBe(200_000);
    expect(bal.find(b => b.userId === 'b')!.net).toBe(-100_000);
    expect(bal.find(b => b.userId === 'c')!.net).toBe(-100_000);
  });

  it('tổng số dư luôn bằng 0', () => {
    const bal = computeBalances(
      [expense('a', 300_000, [['a', 100_000], ['b', 100_000], ['c', 100_000]]),
       expense('b', 90_000, [['b', 30_000], ['c', 60_000]])],
      [A, B, C],
    );
    expect(bal.reduce((s, x) => s + x.net, 0)).toBe(0);
  });

  it('bỏ qua chi tiêu từ quỹ (fundId)', () => {
    const bal = computeBalances([expense('a', 500_000, [['a', 250_000], ['b', 250_000]], 'fund1')], [A, B]);
    expect(bal.every(b => b.net === 0)).toBe(true);
  });
});

describe('settleUp', () => {
  it('B và C mỗi người trả A 100k (2 giao dịch)', () => {
    const { transfers } = computeSettlement(
      [expense('a', 300_000, [['a', 100_000], ['b', 100_000], ['c', 100_000]])],
      [A, B, C],
    );
    expect(transfers).toHaveLength(2);
    expect(transfers.every(t => t.to === 'a' && t.amount === 100_000)).toBe(true);
  });

  it('số giao dịch ≤ số người − 1', () => {
    const { balances, transfers } = computeSettlement(
      [expense('a', 300_000, [['a', 100_000], ['b', 100_000], ['c', 100_000]]),
       expense('b', 60_000, [['a', 30_000], ['c', 30_000]])],
      [A, B, C],
    );
    expect(transfers.length).toBeLessThanOrEqual(balances.length - 1);
    // mỗi người nợ trả đúng tổng nợ của mình
    const paidByDebtor = (u: string) => transfers.filter(t => t.from === u).reduce((s, t) => s + t.amount, 0);
    expect(paidByDebtor('c')).toBe(Math.abs(balances.find(b => b.userId === 'c')!.net));
  });

  it('không ai nợ → không có giao dịch', () => {
    const { transfers } = computeSettlement([expense('a', 100_000, [['a', 100_000]])], [A, B]);
    expect(transfers).toHaveLength(0);
  });
});
