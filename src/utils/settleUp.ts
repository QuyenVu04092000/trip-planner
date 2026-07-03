import type { TripExpense, TripMember } from '../types';

// Chia tiền nhóm: tính số dư ròng mỗi người rồi rút gọn về SỐ LẦN CHUYỂN KHOẢN
// tối thiểu (kiểu Splitwise). Chỉ tính chi tiêu cá nhân (fundId == null);
// chi từ quỹ chung không tính vào nợ giữa các cá nhân.

export interface MemberBalance {
  userId: string;
  displayName: string;
  net: number; // > 0: được nhận lại, < 0: còn nợ
}

export interface Transfer {
  from: string;
  fromName: string;
  to: string;
  toName: string;
  amount: number;
}

// Số dư ròng = (đã trả hộ) − (phần mình phải chịu)
export function computeBalances(
  expenses: TripExpense[],
  members: TripMember[],
): MemberBalance[] {
  const net = new Map<string, number>();
  const nameOf = new Map<string, string>();
  for (const m of members) {
    net.set(m.userId, 0);
    nameOf.set(m.userId, m.displayName);
  }

  for (const e of expenses) {
    if (e.fundId) continue; // chi từ quỹ → bỏ qua
    net.set(e.paidBy, (net.get(e.paidBy) ?? 0) + e.amount);
    for (const s of e.splits) {
      net.set(s.userId, (net.get(s.userId) ?? 0) - s.amount);
    }
  }

  return [...net.entries()].map(([userId, n]) => ({
    userId,
    displayName: nameOf.get(userId) ?? userId,
    net: Math.round(n),
  }));
}

// Rút gọn: ghép người nợ nhiều nhất với người được nhận nhiều nhất (greedy) →
// số giao dịch gần tối thiểu. Bỏ qua lệch < 1 đồng (làm tròn).
export function settleUp(balances: MemberBalance[]): Transfer[] {
  const debtors = balances.filter(b => b.net < 0).map(b => ({ ...b })).sort((a, b) => a.net - b.net);
  const creditors = balances.filter(b => b.net > 0).map(b => ({ ...b })).sort((a, b) => b.net - a.net);

  const transfers: Transfer[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const d = debtors[i];
    const c = creditors[j];
    const amt = Math.min(-d.net, c.net);
    if (amt > 0) {
      transfers.push({
        from: d.userId, fromName: d.displayName,
        to: c.userId, toName: c.displayName,
        amount: Math.round(amt),
      });
      d.net += amt;
      c.net -= amt;
    }
    if (Math.abs(d.net) < 1) i++;
    if (c.net < 1) j++;
  }
  return transfers;
}

// Tiện ích gộp: trả cả số dư + danh sách chuyển khoản tối thiểu.
export function computeSettlement(expenses: TripExpense[], members: TripMember[]) {
  const balances = computeBalances(expenses, members);
  return { balances, transfers: settleUp(balances) };
}
