import { useState } from 'react';
import { CheckCircle2, Circle, Trash2, Loader2 } from 'lucide-react';
import type { TripFund, TripFundPayment, TripMember } from '../types';

interface Props {
  fund: TripFund;
  payments: TripFundPayment[];
  members: TripMember[];
  currentUserId: string;
  canManage: boolean;
  linkedExpenseCount: number;
  onToggle: (payment: TripFundPayment) => Promise<void>;
  onDelete: (fundId: string) => Promise<void>;
}

export default function FundCard({ fund, payments, members, currentUserId, canManage, linkedExpenseCount, onToggle, onDelete }: Props) {
  const [toggling, setToggling] = useState('');
  const [deleting, setDeleting] = useState(false);

  const paidCount      = payments.filter(p => p.paid).length;
  const totalCollected = paidCount * fund.amountPerPerson;
  const totalExpected  = payments.length * fund.amountPerPerson;
  const pct            = totalExpected > 0 ? (totalCollected / totalExpected) * 100 : 0;

  async function handleToggle(p: TripFundPayment) {
    const isMe = p.userId === currentUserId;
    if (!canManage && !isMe) return;
    setToggling(p.id);
    try { await onToggle(p); } finally { setToggling(''); }
  }

  async function handleDelete() {
    const warning = linkedExpenseCount > 0
      ? `Xoá quỹ "${fund.description}"?\n\n⚠️ ${linkedExpenseCount} khoản chi tiêu đang liên kết với quỹ này sẽ bị chuyển thành tiền túi cá nhân.`
      : `Xoá quỹ "${fund.description}"?`;
    if (!confirm(warning)) return;
    setDeleting(true);
    try { await onDelete(fund.id); } finally { setDeleting(false); }
  }

  return (
    <div className="bg-white rounded-2xl border border-amber-100 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-amber-50/60 flex items-center gap-3">
        <span className="text-xl flex-shrink-0">💰</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-800 truncate">{fund.description}</p>
          <p className="text-xs text-amber-700 font-medium mt-0.5">
            {fund.amountPerPerson.toLocaleString('vi-VN')}đ / người
          </p>
          {(() => {
            const member = members.find(m => m.userId === fund.createdBy);
            const name = member?.displayName ?? fund.createdBy;
            const isMe = fund.createdBy === currentUserId;
            return (
              <p className="text-[10px] text-slate-400 mt-0.5">
                Giữ quỹ: <span className="font-medium text-slate-500">{name}{isMe ? ' (bạn)' : ''}</span>
              </p>
            );
          })()}
        </div>
        <div className="text-right flex-shrink-0 mr-1">
          <p className="text-sm font-bold text-slate-700">{paidCount}/{payments.length}</p>
          <p className="text-[10px] text-slate-400">đã nộp</p>
        </div>
        {canManage && (
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="p-1.5 text-slate-300 hover:text-red-400 transition-colors flex-shrink-0"
          >
            {deleting
              ? <Loader2 size={14} className="animate-spin" />
              : <Trash2 size={14} />
            }
          </button>
        )}
      </div>

      {/* Member list */}
      <div className="divide-y divide-slate-50">
        {payments.map(p => {
          const isMe      = p.userId === currentUserId;
          const canToggle = canManage || isMe;
          return (
            <div key={p.id} className="flex items-center gap-3 px-4 py-2.5">
              <button
                onClick={() => handleToggle(p)}
                disabled={toggling === p.id || !canToggle}
                className={`flex-shrink-0 transition-colors ${canToggle ? 'cursor-pointer active:scale-90' : 'cursor-default'}`}
              >
                {toggling === p.id
                  ? <Loader2 size={18} className="animate-spin text-amber-400" />
                  : p.paid
                    ? <CheckCircle2 size={18} className="text-emerald-500" />
                    : <Circle      size={18} className="text-slate-300" />
                }
              </button>

              <span className={`flex-1 text-sm truncate ${p.paid ? 'text-slate-700' : 'text-slate-400'}`}>
                {members.find(m => m.userId === p.userId)?.displayName ?? p.userEmail.split('@')[0]}
                {isMe && <span className="text-slate-400 text-xs ml-1">(bạn)</span>}
              </span>

              <span className={`text-xs font-semibold flex-shrink-0 ${p.paid ? 'text-emerald-600' : 'text-slate-300'}`}>
                {p.paid
                  ? `${fund.amountPerPerson.toLocaleString('vi-VN')}đ ✓`
                  : 'Chưa nộp'
                }
              </span>
            </div>
          );
        })}
      </div>

      {/* Progress */}
      <div className="px-4 pb-3 pt-2 border-t border-slate-50">
        <div className="flex justify-between text-xs text-slate-400 mb-1.5">
          <span>
            Đã thu:{' '}
            <span className="font-semibold text-slate-600">
              {totalCollected.toLocaleString('vi-VN')}đ
            </span>
          </span>
          <span>{totalExpected.toLocaleString('vi-VN')}đ</span>
        </div>
        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-emerald-400 rounded-full transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}
