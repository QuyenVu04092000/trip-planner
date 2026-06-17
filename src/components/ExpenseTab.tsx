import { useState } from 'react';
import { Plus, Trash2, Loader2, Receipt, TrendingUp, TrendingDown, Pencil, Download, PiggyBank } from 'lucide-react';
import type { TripExpense, TripMember, TripFund, TripFundPayment } from '../types';
import { deleteExpense, createExpense, updateExpense, createFund, deleteFund, toggleFundPayment } from '../utils/db';
import { exportExpensesToExcel } from '../utils/exportExpenses';
import AddExpenseModal from './AddExpenseModal';
import FundModal from './FundModal';
import FundCard from './FundCard';

interface Props {
  tripId: string;
  tripName: string;
  expenses: TripExpense[];
  members: TripMember[];
  currentUserId: string;
  isOwner: boolean;
  funds: TripFund[];
  fundPayments: TripFundPayment[];
  onChange: (expenses: TripExpense[]) => void;
  onFundsChange: (funds: TripFund[], payments: TripFundPayment[]) => void;
}

interface Balance {
  userId: string;
  email: string;
  net: number;
}

function calcBalances(
  expenses: TripExpense[],
  members: TripMember[],
  funds: TripFund[],
  fundPayments: TripFundPayment[],
): Balance[] {
  const map: Record<string, { email: string; net: number }> = {};
  for (const m of members) map[m.userId] = { email: m.userEmail, net: 0 };

  // Expenses: payer credited, each split person debited
  for (const exp of expenses) {
    if (map[exp.paidBy]) map[exp.paidBy].net += exp.amount;
    for (const s of exp.splits) {
      if (map[s.userId]) map[s.userId].net -= s.amount;
    }
  }

  // Funds: paid member credited (pre-paid their share),
  //        collector debited (holding group money they must spend)
  for (const fund of funds) {
    const paid = fundPayments.filter(p => p.fundId === fund.id && p.paid);
    for (const payment of paid) {
      if (map[payment.userId]) map[payment.userId].net += fund.amountPerPerson;
      if (map[fund.createdBy]) map[fund.createdBy].net -= fund.amountPerPerson;
    }
  }

  return Object.entries(map).map(([userId, d]) => ({ userId, email: d.email, net: d.net }));
}

function avatarColor(email: string) {
  const colors = ['bg-blue-400', 'bg-violet-400', 'bg-pink-400', 'bg-amber-400', 'bg-emerald-400', 'bg-cyan-400'];
  let hash = 0;
  for (const c of email) hash = (hash * 31 + c.charCodeAt(0)) & 0xfffff;
  return colors[hash % colors.length];
}

function fmt(n: number) {
  return Math.abs(n).toLocaleString('vi-VN') + 'đ';
}

export default function ExpenseTab({
  tripId, tripName, expenses, members, currentUserId, isOwner,
  funds, fundPayments, onChange, onFundsChange,
}: Props) {
  const [showAdd, setShowAdd]             = useState(false);
  const [editExpense, setEditExpense]     = useState<TripExpense | null>(null);
  const [deletingId, setDeletingId]       = useState('');
  const [showFundModal, setShowFundModal] = useState(false);

  const balances      = calcBalances(expenses, members, funds, fundPayments);
  const totalSpent    = expenses.reduce((s, e) => s + e.amount, 0);
  const totalFund     = funds.reduce((s, f) => {
    const paidCount = fundPayments.filter(p => p.fundId === f.id && p.paid).length;
    return s + paidCount * f.amountPerPerson;
  }, 0);
  // Chỉ tính chi từ quỹ (có fundId), không tính tiền túi cá nhân
  const fundSpent     = expenses.filter(e => e.fundId).reduce((s, e) => s + e.amount, 0);
  const fundRemaining = totalFund - fundSpent;

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await deleteExpense(id);
      onChange(expenses.filter(e => e.id !== id));
    } finally {
      setDeletingId('');
    }
  }

  async function handleSave(expense: TripExpense) {
    await createExpense(expense);
    onChange([...expenses, expense]);
  }

  async function handleUpdate(expense: TripExpense) {
    await updateExpense(expense);
    onChange(expenses.map(e => e.id === expense.id ? expense : e));
  }

  async function handleCreateFund(fund: TripFund, payments: TripFundPayment[]) {
    await createFund(fund, payments);
    onFundsChange([...funds, fund], [...fundPayments, ...payments]);
  }

  async function handleDeleteFund(fundId: string) {
    await deleteFund(fundId);
    onFundsChange(
      funds.filter(f => f.id !== fundId),
      fundPayments.filter(p => p.fundId !== fundId),
    );
  }

  async function handleTogglePayment(payment: TripFundPayment) {
    const next = !payment.paid;
    await toggleFundPayment(payment.id, next);
    onFundsChange(
      funds,
      fundPayments.map(p =>
        p.id === payment.id
          ? { ...p, paid: next, paidAt: next ? new Date().toISOString() : null }
          : p
      ),
    );
  }

  const hasFunds    = funds.length > 0;
  const hasExpenses = expenses.length > 0;

  return (
    <div className="flex-1 overflow-auto pb-24">

      {/* ── Thu quỹ ──────────────────────────────────────────────────────── */}
      <div className="px-4 pt-4 pb-2 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Thu quỹ</p>
          <button
            onClick={() => setShowFundModal(true)}
            className="flex items-center gap-1 text-xs font-semibold text-amber-600 px-2.5 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 transition-colors"
          >
            <PiggyBank size={12} /> Tạo quỹ
          </button>
        </div>

        {!hasFunds ? (
          <div className="text-center py-6 text-slate-400 text-xs bg-white rounded-2xl border border-dashed border-slate-200">
            Nhấn "Tạo quỹ" để thu tiền trước khi đi
          </div>
        ) : (
          funds.map(fund => (
            <FundCard
              key={fund.id}
              fund={fund}
              payments={fundPayments.filter(p => p.fundId === fund.id)}
              currentUserId={currentUserId}
              canManage={isOwner || fund.createdBy === currentUserId}
              onToggle={handleTogglePayment}
              onDelete={handleDeleteFund}
            />
          ))
        )}
      </div>

      {/* ── Balance overview ──────────────────────────────────────────────── */}
      {(hasExpenses || hasFunds) && (
        <div className="px-4 pt-2 pb-2">
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-50 flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Tổng quan</span>
              <div className="flex items-center gap-2">
                <div className="text-right">
                  <p className="text-sm font-bold text-slate-700">Chi: {fmt(totalSpent)}</p>
                  {totalFund > 0 && (
                    <p className={`text-[10px] font-semibold ${fundRemaining >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      Quỹ còn: {fundRemaining >= 0 ? '' : '−'}{fmt(fundRemaining)}
                      {fundRemaining < 0 && ' ⚠️'}
                    </p>
                  )}
                </div>
                {hasExpenses && (
                  <button
                    onClick={() => exportExpensesToExcel(tripName, expenses, members)}
                    className="flex items-center gap-1 text-xs font-medium text-blue-600 px-2 py-1 rounded-lg hover:bg-blue-50 transition-colors"
                  >
                    <Download size={12} /> Excel
                  </button>
                )}
              </div>
            </div>
            <div className="divide-y divide-slate-50">
              {balances.map(b => (
                <div key={b.userId} className="flex items-center gap-3 px-4 py-2.5">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 ${avatarColor(b.email)}`}>
                    {b.email.slice(0, 2).toUpperCase()}
                  </div>
                  <span className="flex-1 text-sm text-slate-700 truncate">
                    {b.email.split('@')[0]}
                    {b.userId === currentUserId && <span className="text-slate-400 text-xs ml-1">(bạn)</span>}
                  </span>
                  <div className={`flex items-center gap-1 text-sm font-semibold ${b.net >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                    {b.net >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                    {b.net >= 0 ? '+' : '-'}{fmt(b.net)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Chi tiêu list ─────────────────────────────────────────────────── */}
      <div className="px-4 pt-2 space-y-2">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
          Chi tiêu{hasExpenses ? ` (${expenses.length} khoản)` : ''}
        </p>

        {!hasExpenses ? (
          <div className="flex flex-col items-center justify-center py-10 text-center bg-white rounded-2xl border border-dashed border-slate-200">
            <div className="text-3xl mb-2">💸</div>
            <p className="text-slate-500 font-medium text-sm">Chưa có khoản chi tiêu nào</p>
            <p className="text-slate-400 text-xs mt-1">Nhấn + để thêm chi tiêu chung</p>
          </div>
        ) : (
          expenses.map(exp => {
            const canDelete = true;
            return (
              <div key={exp.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm px-4 py-3">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Receipt size={15} className="text-blue-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{exp.description}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {exp.fundId ? '💰 Từ quỹ · ' : ''}{exp.paidByEmail.split('@')[0]} trả · {exp.splits.length} người
                    </p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <span className="text-sm font-bold text-slate-700">
                      {exp.amount.toLocaleString('vi-VN')}đ
                    </span>
                    <button
                      onClick={() => setEditExpense(exp)}
                      className="p-1.5 text-slate-300 hover:text-blue-400 transition-colors"
                    >
                      <Pencil size={13} />
                    </button>
                    {canDelete && (
                      <button
                        onClick={() => handleDelete(exp.id)}
                        disabled={deletingId === exp.id}
                        className="p-1.5 text-slate-300 hover:text-red-400 transition-colors"
                      >
                        {deletingId === exp.id
                          ? <Loader2 size={13} className="animate-spin" />
                          : <Trash2 size={13} />
                        }
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* FAB */}
      <button
        onClick={() => setShowAdd(true)}
        className="fixed bottom-6 right-6 z-20 w-14 h-14 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg flex items-center justify-center transition-colors active:scale-95"
      >
        <Plus size={22} />
      </button>

      {showAdd && (
        <AddExpenseModal
          tripId={tripId}
          members={members}
          currentUserId={currentUserId}
          funds={funds}
          onSave={handleSave}
          onClose={() => setShowAdd(false)}
        />
      )}

      {editExpense && (
        <AddExpenseModal
          tripId={tripId}
          members={members}
          currentUserId={currentUserId}
          funds={funds}
          initialExpense={editExpense}
          onSave={handleUpdate}
          onClose={() => setEditExpense(null)}
        />
      )}

      {showFundModal && (
        <FundModal
          tripId={tripId}
          members={members}
          currentUserId={currentUserId}
          onSave={handleCreateFund}
          onClose={() => setShowFundModal(false)}
        />
      )}
    </div>
  );
}
