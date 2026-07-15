import { useEffect, useState } from 'react';
import { Users, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { getInviteByToken, acceptInvite } from '../utils/db';
import type { TripInvite } from '../types';

interface Props {
  token: string;
  onAccepted: (tripId: string) => void;
  onDeclined: () => void;
}

export default function InvitePage({ token, onAccepted, onDeclined }: Props) {
  const [invite, setInvite] = useState<TripInvite | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getInviteByToken(token).then((data) => {
      setInvite(data);
      setLoading(false);
    });
  }, [token]);

  async function handleAccept() {
    if (!invite) return;
    setAccepting(true);
    try {
      const tripId = await acceptInvite(token);
      if (tripId) {
        onAccepted(tripId);
      } else {
        setError('Link mời không hợp lệ hoặc đã hết hạn.');
      }
    } catch {
      setError('Có lỗi xảy ra, vui lòng thử lại.');
    } finally {
      setAccepting(false);
    }
  }

  const isExpired = invite && new Date(invite.expiresAt) < new Date();

  return (
    <div className="min-h-screen flex items-center justify-center bg-paper p-4">
      <div className="bg-white rounded-2xl shadow-lg w-full max-w-sm p-6">

        {loading ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 size={32} className="text-terra animate-spin" />
            <p className="text-stone text-sm">Đang kiểm tra link mời...</p>
          </div>
        ) : !invite || isExpired ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <XCircle size={48} className="text-wine" />
            <h2 className="text-lg font-semibold text-ink">Link không hợp lệ</h2>
            <p className="text-sm text-stone">
              {isExpired ? 'Link mời này đã hết hạn (7 ngày).' : 'Link mời không tồn tại.'}
            </p>
            <button
              onClick={onDeclined}
              className="mt-2 text-terra text-sm font-medium"
            >
              Về trang chủ
            </button>
          </div>
        ) : (
          <>
            <div className="flex flex-col items-center gap-3 mb-6">
              <div className="w-16 h-16 rounded-2xl bg-terra-pale flex items-center justify-center text-3xl">
                {invite.tripEmoji}
              </div>
              <div className="text-center">
                <h2 className="text-xl font-bold text-ink">{invite.tripName}</h2>
                <p className="text-sm text-stone mt-1">
                  <span className="font-medium text-stone">{invite.ownerEmail}</span> mời bạn cùng tham gia chuyến đi này
                </p>
              </div>
            </div>

            <div className="bg-terra-pale rounded-xl p-3 flex items-center gap-2.5 mb-6">
              <Users size={16} className="text-terra flex-shrink-0" />
              <p className="text-xs text-terra-dark">
                Bạn sẽ có thể xem và chỉnh sửa lịch trình cùng nhau
              </p>
            </div>

            {error && (
              <p className="text-sm text-wine text-center mb-4">{error}</p>
            )}

            <div className="flex flex-col gap-2">
              <button
                onClick={handleAccept}
                disabled={accepting}
                className="w-full flex items-center justify-center gap-2 bg-terra text-white font-semibold py-3 rounded-xl active:bg-terra-dark transition-colors disabled:opacity-60"
              >
                {accepting
                  ? <><Loader2 size={16} className="animate-spin" /> Đang xử lý...</>
                  : <><CheckCircle size={16} /> Tham gia chuyến đi</>
                }
              </button>
              <button
                onClick={onDeclined}
                className="w-full py-3 text-sm text-stone font-medium"
              >
                Từ chối
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
