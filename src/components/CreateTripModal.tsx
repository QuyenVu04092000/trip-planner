import { useState } from 'react';
import { X, MapPin } from 'lucide-react';
import type { Trip } from '../types';
import DatePicker from './DatePicker';

const COVER_COLORS = [
  'from-blue-400 to-indigo-600',
  'from-rose-400 to-pink-600',
  'from-amber-400 to-orange-600',
  'from-emerald-400 to-teal-600',
  'from-violet-400 to-purple-600',
  'from-cyan-400 to-sky-600',
];

const EMOJIS = ['✈️', '🗺️', '🏖️', '🏔️', '🌏', '🚂', '🛳️', '🏕️', '🌅', '🎒'];

interface Props {
  onClose: () => void;
  onSave: (trip: Omit<Trip, 'id' | 'createdAt' | 'updatedAt'>) => void;
  initialTrip?: Trip;
}

// Shared input class — matches EditForm + DatePicker/TimePicker triggers
const inp = 'w-full border border-slate-200 bg-white rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400 placeholder:text-slate-300 transition-all';
const lbl = 'block text-xs font-semibold text-slate-500 mb-1.5';

export default function CreateTripModal({ onClose, onSave, initialTrip }: Props) {
  const isEdit = !!initialTrip;
  const [name,        setName]        = useState(initialTrip?.name        ?? '');
  const [destination, setDestination] = useState(initialTrip?.destination ?? '');
  const [startDate,   setStartDate]   = useState(initialTrip?.startDate   ?? '');
  const [endDate,     setEndDate]     = useState(initialTrip?.endDate     ?? '');
  const [coverColor,  setCoverColor]  = useState(initialTrip?.coverColor  ?? COVER_COLORS[0]);
  const [emoji,       setEmoji]       = useState(initialTrip?.emoji       ?? '✈️');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSave({ name: name.trim(), destination: destination.trim(), startDate, endDate, coverColor, emoji });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      {/* Card — relative so close button is scoped here */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md fade-in overflow-hidden">

        {/* Close button — inside card, top-right of card */}
        <button
          onClick={onClose}
          className="absolute top-3.5 right-3.5 z-10 w-8 h-8 rounded-xl bg-white/20 hover:bg-white/30 backdrop-blur-sm flex items-center justify-center text-white/80 hover:text-white transition-colors"
        >
          <X size={16} />
        </button>

        {/* Preview header */}
        <div className={`bg-gradient-to-br ${coverColor} px-6 py-5 flex items-center gap-4`}>
          <div className="text-5xl drop-shadow">{emoji}</div>
          <div className="min-w-0">
            <p className="text-white/70 text-xs font-semibold uppercase tracking-wide mb-0.5">
              {isEdit ? 'Chỉnh sửa chuyến đi' : 'Chuyến đi mới'}
            </p>
            <h2 className="text-white text-lg font-bold leading-tight truncate">
              {name || <span className="opacity-50">Tên chuyến đi...</span>}
            </h2>
            {destination && (
              <p className="text-white/80 text-sm mt-0.5 flex items-center gap-1 truncate">
                <MapPin size={11} className="flex-shrink-0" />
                {destination}
              </p>
            )}
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">

          {/* Trip name */}
          <div>
            <label className={lbl}>Tên chuyến đi *</label>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Ví dụ: Hè Đà Nẵng 2025"
              className={inp}
            />
          </div>

          {/* Destination */}
          <div>
            <label className={lbl}>Điểm đến</label>
            <input
              type="text"
              value={destination}
              onChange={e => setDestination(e.target.value)}
              placeholder="Ví dụ: Đà Nẵng, Việt Nam"
              className={inp}
            />
          </div>

          {/* Dates — stacked always since dd/mm/yyyy is long */}
          <div className="grid grid-cols-1 gap-3">
            <DatePicker
              label="Ngày đi"
              value={startDate}
              onChange={v => { setStartDate(v); if (endDate && v > endDate) setEndDate(''); }}
              placeholder="Chọn ngày"
              rangeStart={startDate}
              rangeEnd={endDate}
            />
            <DatePicker
              label="Ngày về"
              value={endDate}
              onChange={setEndDate}
              placeholder="Chọn ngày"
              min={startDate}
              rangeStart={startDate}
              rangeEnd={endDate}
              align="right"
            />
          </div>

          {/* Emoji picker */}
          <div>
            <label className={lbl}>Biểu tượng</label>
            <div className="flex gap-2 flex-wrap">
              {EMOJIS.map(e => (
                <button
                  key={e}
                  type="button"
                  onClick={() => setEmoji(e)}
                  className={`w-10 h-10 rounded-xl text-xl flex items-center justify-center transition-all ${
                    emoji === e
                      ? 'bg-blue-50 ring-2 ring-blue-400 scale-110 shadow-sm'
                      : 'bg-slate-50 hover:bg-slate-100'
                  }`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>

          {/* Cover color */}
          <div>
            <label className={lbl}>Màu bìa</label>
            <div className="flex gap-2.5 flex-wrap">
              {COVER_COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCoverColor(c)}
                  className={`w-8 h-8 rounded-full bg-gradient-to-br ${c} transition-all ${
                    coverColor === c ? 'ring-2 ring-offset-2 ring-blue-500 scale-110' : 'hover:scale-105'
                  }`}
                />
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border border-slate-200 text-slate-600 rounded-xl py-2.5 text-sm font-semibold hover:bg-slate-50 transition-colors"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl py-2.5 text-sm font-semibold transition-colors"
            >
              {isEdit ? 'Lưu thay đổi' : 'Tạo chuyến đi'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
