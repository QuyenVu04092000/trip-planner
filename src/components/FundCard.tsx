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
    <div className="bg-white rounded-2xl border border-gold/30 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-gold-pale/60 flex items-center gap-3">
        <span className="text-xl flex-shrink-0">💰</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-ink truncate">{fund.description}</p>
          <p className="text-xs text-gold-dark font-medium mt-0.5">
            {fund.amountPerPerson.toLocaleString('vi-VN')}đ / người
          </p>
          {(() => {
            const member = members.find(m => m.userId === fund.createdBy);
            const name = member?.displayName ?? fund.createdBy;
            const isMe = fund.createdBy === currentUserId;
            return (
              <p className="text-[10px] text-stone mt-0.5">
                Giữ quỹ: <span className="font-medium text-stone">{name}{isMe ? ' (bạn)' : ''}</span>
              </p>
            );
          })()}
        </div>
        <div className="text-right flex-shrink-0 mr-1">
          <p className="text-sm font-bold text-ink">{paidCount}/{payments.length}</p>
          <p className="text-[10px] text-stone">đã nộp</p>
        </div>
        {canManage && (
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="p-1.5 text-dune hover:text-wine transition-colors flex-shrink-0"
          >
            {deleting
              ? <Loader2 size={14} className="animate-spin" />
              : <Trash2 size={14} />
            }
          </button>
        )}
      </div>

      {/* Member list */}
      <div className="divide-y divide-sand/40">
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
                  ? <Loader2 size={18} className="animate-spin text-gold" />
                  : p.paid
                    ? <CheckCircle2 size={18} className="text-moss" />
                    : <Circle      size={18} className="text-dune" />
                }
              </button>

              <span className={`flex-1 text-sm truncate ${p.paid ? 'text-ink' : 'text-stone'}`}>
                {members.find(m => m.userId === p.userId)?.displayName ?? p.userEmail.split('@')[0]}
                {isMe && <span className="text-stone text-xs ml-1">(bạn)</span>}
              </span>

              <span className={`text-xs font-semibold flex-shrink-0 ${p.paid ? 'text-sage-dark' : 'text-dune'}`}>
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
      <div className="px-4 pb-3 pt-2 border-t border-sand/40">
        <div className="flex justify-between text-xs text-stone mb-1.5">
          <span>
            Đã thu:{' '}
            <span className="font-semibold text-stone">
              {totalCollected.toLocaleString('vi-VN')}đ
            </span>
          </span>
          <span>{totalExpected.toLocaleString('vi-VN')}đ</span>
        </div>
        <div className="h-1.5 bg-parchment rounded-full overflow-hidden">
          <div
            className="h-full bg-moss rounded-full transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}
