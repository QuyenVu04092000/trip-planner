import { useState, useEffect } from 'react';
import { X, Loader2, Equal, Sliders, Wallet, PiggyBank } from 'lucide-react';
import type { TripMember, TripExpense, ExpenseSplit, TripFund } from '../types';

interface Props {
  tripId: string;
  members: TripMember[];
  currentUserId: string;
  funds: TripFund[];
  initialExpense?: TripExpense;
  onSave: (expense: TripExpense) => Promise<void>;
  onClose: () => void;
}

function avatarColor(email: string) {
  const colors = ['bg-blue-400','bg-violet-400','bg-pink-400','bg-amber-400','bg-emerald-400','bg-cyan-400'];
  let hash = 0;
  for (const c of email) hash = (hash * 31 + c.charCodeAt(0)) & 0xfffff;
  return colors[hash % colors.length];
}

function parseVnd(val: string): number {
  return parseInt(val.replace(/[^0-9]/g, ''), 10) || 0;
}

function fmtInput(val: string): string {
  const num = val.replace(/[^0-9]/g, '');
  return num ? Number(num).toLocaleString('vi-VN') : '';
}

export default function AddExpenseModal({
  tripId, members, currentUserId, funds, initialExpense, onSave, onClose,
}: Props) {
  const isEdit = !!initialExpense;

  const [description, setDescription] = useState(initialExpense?.description ?? '');
  const [amount, setAmount]           = useState(initialExpense ? initialExpense.amount.toLocaleString('vi-VN') : '');
  const [paidBy, setPaidBy]           = useState(initialExpense?.paidBy ?? currentUserId);
  const [splitType, setSplitType]     = useState<'equal' | 'custom'>('equal');
  const [paySource, setPaySource]     = useState<'personal' | 'fund'>(initialExpense?.fundId ? 'fund' : 'personal');
  const [selectedFundId, setSelectedFundId] = useState<string>(initialExpense?.fundId ?? funds[0]?.id ?? '');

  const [splitWith, setSplitWith] = useState<Set<string>>(
    () => new Set(initialExpense ? initialExpense.splits.map(s => s.userId) : members.map(m => m.userId))
  );

  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>(() => {
    if (initialExpense) {
      const map: Record<string, string> = {};
      for (const s of initialExpense.splits) map[s.userId] = s.amount.toLocaleString('vi-VN');
      return map;
    }
    return {};
  });

  const [saving, setSaving] = useState(false);

  const numAmount  = parseVnd(amount);
  const splitCount = splitWith.size;
  const perPerson  = splitCount > 0 ? Math.round(numAmount / splitCount) : 0;

  const customTotal     = Object.values(customAmounts).reduce((s, v) => s + parseVnd(v), 0);
  const customRemainder = numAmount - customTotal;

  // Resolve who is effectively paying
  const selectedFund       = funds.find(f => f.id === selectedFundId);
  const fundCollectorId    = selectedFund?.createdBy ?? '';
  const fundCollector      = members.find(m => m.userId === fundCollectorId);
  const effectivePaidBy    = paySource === 'fund' ? fundCollectorId : paidBy;
  const effectivePaidByEmail = paySource === 'fund'
    ? (fundCollector?.userEmail ?? '')
    : (members.find(m => m.userId === paidBy)?.userEmail ?? '');

  useEffect(() => {
    if (splitType === 'custom' && numAmount > 0) {
      const next: Record<string, string> = {};
      members.forEach(m => {
        next[m.userId] = customAmounts[m.userId] ?? (splitWith.has(m.userId) ? perPerson.toLocaleString('vi-VN') : '0');
      });
      setCustomAmounts(next);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [splitType]);

  function toggleSplit(userId: string) {
    setSplitWith(prev => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId); else next.add(userId);
      return next;
    });
  }

  function buildSplits(): ExpenseSplit[] {
    if (splitType === 'equal') {
      return members
        .filter(m => splitWith.has(m.userId))
        .map(m => ({ userId: m.userId, email: m.userEmail, amount: perPerson }));
    }
    return members
      .map(m => ({ userId: m.userId, email: m.userEmail, amount: parseVnd(customAmounts[m.userId] ?? '0') }))
      .filter(s => s.amount > 0);
  }

  function canSave() {
    if (!description.trim() || numAmount <= 0) return false;
    if (paySource === 'fund' && !fundCollectorId) return false;
    if (splitType === 'equal') return splitWith.size > 0;
    return buildSplits().length > 0 && customRemainder === 0;
  }

  async function handleSave() {
    if (!canSave()) return;
    setSaving(true);
    try {
      const expense: TripExpense = {
        id:          initialExpense?.id ?? `exp_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        tripId,
        description: description.trim(),
        amount:      numAmount,
        paidBy:      effectivePaidBy,
        paidByEmail: effectivePaidByEmail,
        splits:      buildSplits(),
        date:        initialExpense?.date ?? new Date().toISOString().split('T')[0],
        createdAt:   initialExpense?.createdAt ?? new Date().toISOString(),
        fundId:      paySource === 'fund' ? selectedFundId : null,
      };
      await onSave(expense);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const hasFunds = funds.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white w-full max-w-sm rounded-t-3xl sm:rounded-2xl shadow-xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-5 pb-3 border-b border-slate-100">
          <h2 className="font-semibold text-slate-800">{isEdit ? 'Chỉnh sửa chi tiêu' : 'Thêm chi tiêu'}</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-4 max-h-[75vh] overflow-y-auto">

          {/* Pay source toggle — only show if funds exist */}
          {hasFunds && (
            <div className="flex gap-2 p-1 bg-slate-100 rounded-xl">
              <button
                onClick={() => setPaySource('personal')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                  paySource === 'personal'
                    ? 'bg-white text-slate-800 shadow-sm'
                    : 'text-slate-500'
                }`}
              >
                <Wallet size={13} /> Tiền túi
              </button>
              <button
                onClick={() => setPaySource('fund')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                  paySource === 'fund'
                    ? 'bg-amber-400 text-white shadow-sm'
                    : 'text-slate-500'
                }`}
              >
                <PiggyBank size={13} /> Từ quỹ
              </button>
            </div>
          )}

          {/* Fund selector (if multiple funds) */}
          {paySource === 'fund' && funds.length > 1 && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Chọn quỹ</label>
              <select
                value={selectedFundId}
                onChange={e => setSelectedFundId(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-amber-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300 bg-white"
              >
                {funds.map(f => (
                  <option key={f.id} value={f.id}>{f.description}</option>
                ))}
              </select>
            </div>
          )}

          {/* Fund info */}
          {paySource === 'fund' && selectedFund && fundCollector && (
            <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 rounded-xl border border-amber-100">
              <PiggyBank size={14} className="text-amber-500 flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-amber-800 truncate">{selectedFund.description}</p>
                <p className="text-[10px] text-amber-600">
                  Giữ quỹ: {fundCollector.userEmail.split('@')[0]}
                  {fundCollector.userId === currentUserId ? ' (bạn)' : ''}
                </p>
              </div>
            </div>
          )}

          {/* Description */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Mô tả</label>
            <input
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Vd: Ăn tối, Tiền nhà..."
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>

          {/* Amount */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Số tiền (đ)</label>
            <input
              type="text"
              inputMode="numeric"
              value={amount}
              onChange={e => setAmount(fmtInput(e.target.value))}
              placeholder="0"
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>

          {/* Paid by — only shown for personal */}
          {paySource === 'personal' && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Người trả</label>
              <select
                value={paidBy}
                onChange={e => setPaidBy(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
              >
                {members.map(m => (
                  <option key={m.userId} value={m.userId}>
                    {m.userEmail}{m.userId === currentUserId ? ' (bạn)' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Split type toggle */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Cách chia</label>
            <div className="flex gap-2">
              <button
                onClick={() => setSplitType('equal')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-medium border transition-colors ${
                  splitType === 'equal'
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-slate-500 border-slate-200'
                }`}
              >
                <Equal size={13} /> Chia đều
              </button>
              <button
                onClick={() => setSplitType('custom')}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-medium border transition-colors ${
                  splitType === 'custom'
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-slate-500 border-slate-200'
                }`}
              >
                <Sliders size={13} /> Tuỳ chỉnh
              </button>
            </div>
          </div>

          {/* Equal split */}
          {splitType === 'equal' && (
            <div className="space-y-2">
              <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                Chia cho ({splitWith.size} người{perPerson > 0 ? ` · ${perPerson.toLocaleString('vi-VN')}đ/người` : ''})
              </label>
              <div className="space-y-1">
                {members.map(m => {
                  const checked = splitWith.has(m.userId);
                  return (
                    <button
                      key={m.userId}
                      onClick={() => toggleSplit(m.userId)}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl transition-colors ${
                        checked ? 'bg-blue-50 border border-blue-200' : 'bg-slate-50 border border-transparent'
                      }`}
                    >
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 ${avatarColor(m.userEmail)}`}>
                        {m.userEmail.slice(0, 2).toUpperCase()}
                      </div>
                      <span className="flex-1 text-left text-sm text-slate-700 truncate">
                        {m.userEmail}{m.userId === currentUserId ? ' (bạn)' : ''}
                      </span>
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                        checked ? 'border-blue-500 bg-blue-500' : 'border-slate-300'
                      }`}>
                        {checked && <span className="text-white text-[10px] font-bold">✓</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Custom split */}
          {splitType === 'custom' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Số tiền từng người</label>
                {numAmount > 0 && (
                  <span className={`text-xs font-semibold ${customRemainder === 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                    {customRemainder === 0
                      ? '✓ Khớp'
                      : customRemainder > 0
                        ? `Còn thiếu ${customRemainder.toLocaleString('vi-VN')}đ`
                        : `Vượt quá ${(-customRemainder).toLocaleString('vi-VN')}đ`
                    }
                  </span>
                )}
              </div>
              <div className="space-y-2">
                {members.map(m => (
                  <div key={m.userId} className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 ${avatarColor(m.userEmail)}`}>
                      {m.userEmail.slice(0, 2).toUpperCase()}
                    </div>
                    <span className="flex-1 text-sm text-slate-700 truncate min-w-0">
                      {m.userEmail.split('@')[0]}{m.userId === currentUserId ? ' (bạn)' : ''}
                    </span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={customAmounts[m.userId] ?? ''}
                      onChange={e => setCustomAmounts(prev => ({ ...prev, [m.userId]: fmtInput(e.target.value) }))}
                      placeholder="0"
                      className="w-28 px-2.5 py-1.5 rounded-xl border border-slate-200 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Save */}
          <button
            onClick={handleSave}
            disabled={!canSave() || saving}
            className="w-full py-3 bg-blue-600 text-white font-semibold rounded-xl disabled:opacity-40 transition-colors active:bg-blue-700"
          >
            {saving ? <Loader2 size={16} className="animate-spin mx-auto" /> : isEdit ? 'Cập nhật' : 'Lưu'}
          </button>
        </div>
      </div>
    </div>
  );
}
