import { useState } from 'react';
import { X, Loader2, User } from 'lucide-react';
import { upsertProfile } from '../utils/db';

interface Props {
  currentName: string;
  email: string;
  onSave: (name: string) => void;
  onClose: () => void;
}

export default function ProfileModal({ currentName, email, onSave, onClose }: Props) {
  const [name, setName] = useState(currentName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    setError('');
    try {
      await upsertProfile(name.trim());
      onSave(name.trim());
      onClose();
    } catch {
      setError('Lưu thất bại, thử lại nhé');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white w-full max-w-sm rounded-t-3xl sm:rounded-2xl shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-4 pt-5 pb-3 border-b border-sand">
          <h2 className="font-semibold text-ink">Hồ sơ của bạn</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-stone hover:bg-parchment">
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="flex items-center gap-3 px-3 py-2.5 bg-paper rounded-xl">
            <div className="w-9 h-9 rounded-full bg-terra-pale flex items-center justify-center flex-shrink-0">
              <User size={16} className="text-terra" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-stone">Tài khoản</p>
              <p className="text-sm font-medium text-ink truncate">{email}</p>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-stone uppercase tracking-wide">
              Tên hiển thị
            </label>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') onClose(); }}
              placeholder="Nhập tên của bạn..."
              maxLength={30}
              className="w-full px-3 py-2.5 rounded-xl border border-sand text-sm focus:outline-none focus:ring-2 focus:ring-terra/40"
            />
            <p className="text-[11px] text-stone">Tên này sẽ hiển thị trong chi tiêu, kỷ niệm và xuất Excel</p>
          </div>

          {error && <p className="text-xs text-wine">{error}</p>}

          <button
            onClick={handleSave}
            disabled={!name.trim() || saving}
            className="w-full py-3 bg-terra text-white font-semibold rounded-xl disabled:opacity-40 transition-colors active:bg-terra-dark"
          >
            {saving ? <Loader2 size={16} className="animate-spin mx-auto" /> : 'Lưu tên'}
          </button>
        </div>
      </div>
    </div>
  );
}
