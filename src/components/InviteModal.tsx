import { useEffect, useState } from 'react';
import { X, Link2, Copy, Check, Users, Crown, LogOut, Trash2, Loader2 } from 'lucide-react';
import { createInvite, fetchTripMembers, removeMember, leaveTrip } from '../utils/db';
import type { Trip, TripMember } from '../types';

interface Props {
  trip: Trip;
  currentUserId: string;
  isOwner: boolean;
  onClose: () => void;
  onLeave: () => void; // called when member leaves trip
}

function avatarInitials(email: string) {
  return email.slice(0, 2).toUpperCase();
}

function avatarColor(email: string) {
  const colors = [
    'bg-blue-400', 'bg-violet-400', 'bg-pink-400',
    'bg-amber-400', 'bg-emerald-400', 'bg-cyan-400',
  ];
  let hash = 0;
  for (const c of email) hash = (hash * 31 + c.charCodeAt(0)) & 0xfffff;
  return colors[hash % colors.length];
}

export default function InviteModal({ trip, currentUserId, isOwner, onClose, onLeave }: Props) {
  const [members, setMembers] = useState<TripMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [generatingLink, setGeneratingLink] = useState(false);
  const [inviteUrl, setInviteUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [removingId, setRemovingId] = useState('');
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    fetchTripMembers(trip.id)
      .then(setMembers)
      .finally(() => setLoadingMembers(false));
  }, [trip.id]);

  async function handleGenerateLink() {
    setGeneratingLink(true);
    try {
      const token = await createInvite(trip);
      const url = `${window.location.origin}${window.location.pathname}#/invite/${token}`;
      setInviteUrl(url);
    } finally {
      setGeneratingLink(false);
    }
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleRemove(member: TripMember) {
    setRemovingId(member.id);
    try {
      await removeMember(trip.id, member.userId);
      setMembers(prev => prev.filter(m => m.id !== member.id));
    } finally {
      setRemovingId('');
    }
  }

  async function handleLeave() {
    setLeaving(true);
    try {
      await leaveTrip(trip.id);
      onLeave();
    } finally {
      setLeaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white w-full max-w-sm rounded-t-3xl sm:rounded-2xl shadow-xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-5 pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Users size={18} className="text-blue-500" />
            <h2 className="font-semibold text-slate-800">Thành viên</h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100">
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">

          {/* Invite link — chỉ owner mới thấy */}
          {isOwner && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Mời người khác</p>
              {!inviteUrl ? (
                <button
                  onClick={handleGenerateLink}
                  disabled={generatingLink}
                  className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white text-sm font-semibold py-2.5 rounded-xl active:bg-blue-700 transition-colors disabled:opacity-60"
                >
                  {generatingLink
                    ? <><Loader2 size={14} className="animate-spin" /> Đang tạo link...</>
                    : <><Link2 size={14} /> Tạo link mời (hết hạn sau 7 ngày)</>
                  }
                </button>
              ) : (
                <div className="flex items-center gap-2 bg-slate-50 rounded-xl px-3 py-2.5 border border-slate-200">
                  <p className="flex-1 text-xs text-slate-600 truncate">{inviteUrl}</p>
                  <button
                    onClick={handleCopy}
                    className="flex-shrink-0 flex items-center gap-1 text-xs font-semibold text-blue-600 active:text-blue-800"
                  >
                    {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                    {copied ? 'Đã copy' : 'Copy'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Members list */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">
              Danh sách ({members.length})
            </p>

            {loadingMembers ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 size={20} className="text-slate-300 animate-spin" />
              </div>
            ) : (
              <div className="space-y-1">
                {members.map(member => (
                  <div key={member.id} className="flex items-center gap-3 py-2 px-1">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 ${avatarColor(member.userEmail)}`}>
                      {avatarInitials(member.userEmail)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-slate-700 truncate">{member.userEmail}</p>
                    </div>
                    {member.role === 'owner' && (
                      <span className="flex items-center gap-1 text-xs text-amber-500 font-medium flex-shrink-0">
                        <Crown size={12} /> Owner
                      </span>
                    )}
                    {/* Owner có thể xóa member */}
                    {isOwner && member.role === 'member' && (
                      <button
                        onClick={() => handleRemove(member)}
                        disabled={removingId === member.id}
                        className="flex-shrink-0 p-1 text-slate-300 hover:text-red-400 transition-colors"
                      >
                        {removingId === member.id
                          ? <Loader2 size={14} className="animate-spin" />
                          : <Trash2 size={14} />
                        }
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Member có thể rời trip */}
          {!isOwner && (
            <button
              onClick={handleLeave}
              disabled={leaving}
              className="w-full flex items-center justify-center gap-2 text-red-500 text-sm font-medium py-2.5 rounded-xl border border-red-100 hover:bg-red-50 transition-colors disabled:opacity-60"
            >
              {leaving
                ? <><Loader2 size={14} className="animate-spin" /> Đang rời...</>
                : <><LogOut size={14} /> Rời chuyến đi</>
              }
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
