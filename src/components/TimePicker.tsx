import { useState, useRef, useEffect } from 'react';
import { Clock, X } from 'lucide-react';

interface Props {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
}

const SLOTS = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, '0');
  const m = i % 2 === 0 ? '00' : '30';
  return `${h}:${m}`;
});

export default function TimePicker({ value, onChange, placeholder = 'Chọn giờ' }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-slot="${value}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: 'center' });
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`
          w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-sm
          border transition-all duration-150 bg-white text-left
          ${open
            ? 'border-terra ring-2 ring-terra/15 shadow-sm'
            : 'border-sand hover:border-terra/40 hover:shadow-sm'
          }
        `}
      >
        <span className="text-stone flex-shrink-0"><Clock size={15} /></span>
        <span className={`flex-1 font-medium ${value ? 'text-ink' : 'text-stone'}`}>
          {value || placeholder}
        </span>
        {value && (
          <span
            role="button"
            onClick={e => { e.stopPropagation(); onChange(''); }}
            className="inline-flex items-center justify-center text-dune hover:text-stone transition-colors flex-shrink-0"
          >
            <X size={13} />
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute top-[calc(100%+8px)] left-0 z-50 bg-white rounded-2xl shadow-2xl border border-sand py-2 w-28"
          style={{ animation: 'dropIn 0.15s ease-out' }}
        >
          <div ref={listRef} className="overflow-y-auto max-h-52 space-y-0.5 px-2">
            {SLOTS.map(slot => (
              <button
                key={slot}
                data-slot={slot}
                type="button"
                onClick={() => { onChange(slot); setOpen(false); }}
                className={`w-full text-center py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  slot === value ? 'bg-terra text-white' : 'hover:bg-parchment text-ink'
                }`}
              >
                {slot}
              </button>
            ))}
          </div>
        </div>
      )}

      <style>{`
        @keyframes dropIn {
          from { opacity: 0; transform: translateY(-6px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}
