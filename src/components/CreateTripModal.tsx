import { useRef, useState } from 'react';
import { X, MapPin, ImagePlus, Plus, Loader2 } from 'lucide-react';
import type { Trip } from '../types';
import DatePicker from './DatePicker';
import PlacesAutocomplete from './PlacesAutocomplete';
import TripIcon from './TripIcon';
import { coverProps, isHexColor, imageToIcon, firstGrapheme } from '../utils/tripCover';

// Bảng cover mới — tông đất theo journal palette
const COVER_COLORS = [
  'from-terra to-terra-dark',
  'from-moss to-sage-dark',
  'from-gold to-gold-dark',
  'from-clay to-clay-dark',
  'from-slateblue to-ink',
  'from-plum to-ink-light',
];

// GIỮ NGUYÊN — cover của trip cũ lưu các class này trong DB; liệt kê ở đây để
// Tailwind vẫn generate CSS cho chúng (JIT quét source). Không dùng trực tiếp.
export const LEGACY_COVER_COLORS = [
  'from-blue-400 to-indigo-600',
  'from-rose-400 to-pink-600',
  'from-amber-400 to-orange-600',
  'from-emerald-400 to-teal-600',
  'from-violet-400 to-purple-600',
  'from-cyan-400 to-sky-600',
];

const EMOJIS = [
  '✈️', '🗺️', '🏖️', '🏔️', '🌏', '🚂', '🛳️', '🏕️', '🌅', '🎒',
  '🚗', '🏍️', '🚲', '🏝️', '🏙️', '🏯', '⛩️', '🗼',
  '🍜', '☕', '📸', '❤️', '🌸',
];

interface Props {
  onClose: () => void;
  onSave: (trip: Omit<Trip, 'id' | 'createdAt' | 'updatedAt'>) => void;
  initialTrip?: Trip;
}

// Shared input class — matches EditForm + DatePicker/TimePicker triggers
const inp = 'w-full border border-sand bg-white rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-terra/25 focus:border-terra placeholder:text-dune transition-all';
const lbl = 'block text-xs font-semibold text-stone mb-1.5';

export default function CreateTripModal({ onClose, onSave, initialTrip }: Props) {
  const isEdit = !!initialTrip;
  const [name,        setName]        = useState(initialTrip?.name        ?? '');
  const [destination, setDestination] = useState(initialTrip?.destination ?? '');
  const [lat,         setLat]         = useState<number | null>(initialTrip?.lat ?? null);
  const [lon,         setLon]         = useState<number | null>(initialTrip?.lon ?? null);
  const [startDate,   setStartDate]   = useState(initialTrip?.startDate   ?? '');
  const [endDate,     setEndDate]     = useState(initialTrip?.endDate     ?? '');
  const [coverColor,  setCoverColor]  = useState(initialTrip?.coverColor  ?? COVER_COLORS[0]);
  const [emoji,       setEmoji]       = useState(initialTrip?.emoji       ?? '✈️');
  const [iconImage,   setIconImage]   = useState<string | null>(initialTrip?.iconImage ?? null);
  // Màu tự chọn gần nhất — giữ lại để ô "tuỳ chọn" vẫn hiện màu đó khi bấm qua màu có sẵn.
  const [customColor, setCustomColor] = useState(isHexColor(initialTrip?.coverColor) ? initialTrip!.coverColor : '#3A7BD5');
  const [customEmoji, setCustomEmoji] = useState('');
  const [iconBusy,    setIconBusy]    = useState(false);
  const [iconError,   setIconError]   = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const pickEmoji = (e: string) => {
    setEmoji(e);
    setIconImage(null);
  };

  const handleIconFile = async (file: File | undefined) => {
    if (!file) return;
    setIconError('');
    setIconBusy(true);
    try {
      setIconImage(await imageToIcon(file));
    } catch {
      setIconError('Không đọc được ảnh này, thử ảnh khác nhé.');
    } finally {
      setIconBusy(false);
      if (fileRef.current) fileRef.current.value = ''; // chọn lại cùng file vẫn bắt được
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSave({ name: name.trim(), destination: destination.trim(), lat, lon, startDate, endDate, coverColor, emoji, iconImage });
  };

  const cover = coverProps(coverColor);
  const isCustomEmoji = !iconImage && !EMOJIS.includes(emoji);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 backdrop-blur-sm">
      {/* min-h-full + flex: form ngắn thì căn giữa, dài hơn màn hình thì cuộn được */}
      <div className="min-h-full flex items-center justify-center p-4 pt-safe-4 pb-safe-5">
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
        <div className={`${cover.className} px-6 py-5 flex items-center gap-4`} style={cover.style}>
          <TripIcon trip={{ emoji, iconImage }} size={52} className="text-5xl drop-shadow" />
          <div className="min-w-0">
            <p className="text-white/70 text-xs font-semibold uppercase tracking-wide mb-0.5">
              {isEdit ? 'Chỉnh sửa chuyến đi' : 'Chuyến đi mới'}
            </p>
            <h2 className="text-white text-lg font-bold leading-tight truncate" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.35)' }}>
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

          {/* Destination — chọn từ bản đồ để lưu toạ độ (cho thời tiết) */}
          <div>
            <label className={lbl}>Điểm đến</label>
            <PlacesAutocomplete
              value={destination}
              lat={lat}
              lon={lon}
              onChange={(v, coords) => {
                setDestination(v);
                setLat(coords?.lat ?? null);
                setLon(coords?.lon ?? null);
              }}
              placeholder="Chọn điểm đến trên bản đồ..."
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

          {/* Biểu tượng: emoji có sẵn / emoji tự gõ / ảnh tự tải lên */}
          <div>
            <label className={lbl}>Biểu tượng</label>
            <div className="flex gap-2 flex-wrap">
              {/* Tải ảnh lên */}
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={iconBusy}
                title="Tải ảnh lên làm biểu tượng"
                className={`w-10 h-10 rounded-xl flex items-center justify-center overflow-hidden transition-all ${
                  iconImage ? 'ring-2 ring-terra/40 scale-110 shadow-sm' : 'bg-paper hover:bg-parchment text-stone border border-dashed border-dune'
                }`}
              >
                {iconBusy ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : iconImage ? (
                  <img src={iconImage} alt="" className="w-full h-full object-cover" />
                ) : (
                  <ImagePlus size={17} />
                )}
              </button>
              {/* Emoji tự gõ (đang chọn) */}
              {isCustomEmoji && (
                <button
                  type="button"
                  className="w-10 h-10 rounded-xl text-xl flex items-center justify-center bg-terra-pale ring-2 ring-terra/40 scale-110 shadow-sm"
                >
                  {emoji}
                </button>
              )}
              {EMOJIS.map(e => (
                <button
                  key={e}
                  type="button"
                  onClick={() => pickEmoji(e)}
                  className={`w-10 h-10 rounded-xl text-xl flex items-center justify-center transition-all ${
                    !iconImage && emoji === e
                      ? 'bg-terra-pale ring-2 ring-terra/40 scale-110 shadow-sm'
                      : 'bg-paper hover:bg-parchment'
                  }`}
                >
                  {e}
                </button>
              ))}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={e => void handleIconFile(e.target.files?.[0])}
            />
            {/* Emoji bất kỳ — gõ/dán từ bàn phím emoji */}
            <div className="flex items-center gap-2 mt-2.5">
              <input
                type="text"
                value={customEmoji}
                onChange={e => {
                  const g = firstGrapheme(e.target.value);
                  setCustomEmoji(g);
                  if (g) pickEmoji(g);
                }}
                placeholder="Hoặc gõ emoji bất kỳ…"
                className={`${inp} !py-2 text-base`}
              />
              {iconImage && (
                <button
                  type="button"
                  onClick={() => setIconImage(null)}
                  className="flex-shrink-0 text-xs font-semibold text-stone hover:text-wine px-2 py-2 transition-colors"
                >
                  Bỏ ảnh
                </button>
              )}
            </div>
            {iconImage && (
              <p className="text-[11px] text-dune mt-1.5">
                Widget & thông báo chỉ hiện được emoji nên sẽ dùng <span className="text-base align-middle">{emoji}</span>
              </p>
            )}
            {iconError && <p className="text-xs text-wine mt-1.5">{iconError}</p>}
          </div>

          {/* Màu bìa: màu có sẵn + màu tự chọn bất kỳ */}
          <div>
            <label className={lbl}>Màu bìa</label>
            <div className="flex gap-2.5 flex-wrap items-center">
              {COVER_COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCoverColor(c)}
                  className={`w-8 h-8 rounded-full bg-gradient-to-br ${c} transition-all ${
                    coverColor === c ? 'ring-2 ring-offset-2 ring-terra scale-110' : 'hover:scale-105'
                  }`}
                />
              ))}
              {/* Màu tuỳ chọn — mở bảng màu hệ thống */}
              <label
                title="Chọn màu bất kỳ"
                className={`relative w-8 h-8 rounded-full cursor-pointer transition-all flex items-center justify-center ${
                  isHexColor(coverColor) ? 'ring-2 ring-offset-2 ring-terra scale-110' : 'hover:scale-105'
                }`}
                style={
                  isHexColor(coverColor)
                    ? coverProps(customColor).style
                    : { background: 'conic-gradient(#f43f5e, #f59e0b, #84cc16, #06b6d4, #6366f1, #d946ef, #f43f5e)' }
                }
              >
                {!isHexColor(coverColor) && (
                  <span className="w-5 h-5 rounded-full bg-white/90 flex items-center justify-center text-stone">
                    <Plus size={12} strokeWidth={3} />
                  </span>
                )}
                <input
                  type="color"
                  value={customColor}
                  onChange={e => {
                    setCustomColor(e.target.value);
                    setCoverColor(e.target.value);
                  }}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                />
              </label>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border border-sand text-stone rounded-xl py-2.5 text-sm font-semibold hover:bg-paper transition-colors"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="flex-1 bg-terra hover:bg-terra-dark disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl py-2.5 text-sm font-semibold transition-colors"
            >
              {isEdit ? 'Lưu thay đổi' : 'Tạo chuyến đi'}
            </button>
          </div>
        </form>
      </div>
      </div>
    </div>
  );
}
