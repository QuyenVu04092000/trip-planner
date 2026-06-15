import { useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import type { TripFund, TripFundPayment, TripMember } from '../types';

interface Props {
  tripId: string;
  members: TripMember[];
  currentUserId: string;
  onSave: (fund: TripFund, payments: TripFundPayment[]) => Promise<void>;
  onClose: () => void;
}

function fmtInput(val: string): string {
  const n = val.replace(/\D/g, '');
  return n ? parseInt(n, 10).toLocaleString('vi-VN') : '';
}

export default function FundModal({ tripId, members, currentUserId, onSave, onClose }: Props) {
  const [description, setDescription] = useState('Quỹ chuyến đi');
  const [amount, setAmount]           = useState('');
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState('');

  const rawAmount = parseInt(amount.replace(/\D/g, ''), 10) || 0;
  const total     = rawAmount * members.length;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!rawAmount)            { setError('Nhập số tiền mỗi người'); return; }
    if (!description.trim())   { setError('Nhập tên quỹ'); return; }

    setSaving(true);
    setError('');
    const now    = new Date().toISOString();
    const fundId = `fund_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    const fund: TripFund = {
      id:              fundId,
      tripId,
      description:     description.trim(),
      amountPerPerson: rawAmount,
      createdBy:       currentUserId,
      createdAt:       now,
    };

    const payments: TripFundPayment[] = members.map((m, i) => ({
      id:        `fp_${Date.now()}_${i}_${Math.random().toString(36).slice(2)}`,
      fundId,
      tripId,
      userId:    m.userId,
      userEmail: m.userEmail,
      paid:      false,
      paidAt:    null,
    }));

    try {
      await onSave(fund, payments);
      onClose();
    } catch {
      setError('Có lỗi xảy ra, thử lại nhé');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-slate-100">
          <h2 className="text-base font-bold text-slate-800">Tạo quỹ chuyến đi</h2>
          <button onClick={onClose} className="w-8 h-8 bg-slate-100 rounded-xl flex items-center justify-center text-slate-500">
            <X size={15} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Tên quỹ</label>
            <input
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300 text-slate-800"
              placeholder="Quỹ chuyến đi"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
              Mỗi người nộp (đ)
            </label>
            <input
              inputMode="numeric"
              value={amount}
              onChange={e => setAmount(fmtInput(e.target.value))}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300 text-slate-800"
              placeholder="500.000"
            />
          </div>

          {rawAmount > 0 && (
            <div className="bg-amber-50 rounded-xl px-4 py-3 flex items-center justify-between">
              <span className="text-xs text-amber-700">
                {members.length} người × {rawAmount.toLocaleString('vi-VN')}đ
              </span>
              <span className="text-sm font-bold text-amber-700">
                = {total.toLocaleString('vi-VN')}đ
              </span>
            </div>
          )}

          {/* Member preview */}
          <div className="bg-slate-50 rounded-xl px-4 py-3 space-y-2">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Thành viên</p>
            {members.map(m => (
              <div key={m.userId} className="flex items-center gap-2 text-sm text-slate-600">
                <span className="w-1.5 h-1.5 bg-slate-300 rounded-full flex-shrink-0" />
                {m.userEmail.split('@')[0]}
                {m.userId === currentUserId && <span className="text-slate-400 text-xs">(bạn)</span>}
              </div>
            ))}
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <button
            type="submit"
            disabled={saving || !rawAmount}
            className="w-full py-3 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-200 disabled:text-slate-400 text-white font-semibold rounded-2xl flex items-center justify-center gap-2 transition-colors"
          >
            {saving && <Loader2 size={16} className="animate-spin" />}
            Tạo quỹ
          </button>
        </form>
      </div>
    </div>
  );
}
