import { useState, useRef, useEffect } from 'react';
import { ChevronLeft, ChevronRight, CalendarDays, X } from 'lucide-react';

interface Props {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  min?: string;
  label?: string;
  icon?: React.ReactNode;
  rangeStart?: string;
  rangeEnd?: string;
  align?: 'left' | 'right';
}

const WEEKDAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
const MONTHS_SHORT = ['Th1','Th2','Th3','Th4','Th5','Th6','Th7','Th8','Th9','Th10','Th11','Th12'];
const MONTHS_FULL  = [
  'Tháng 1','Tháng 2','Tháng 3','Tháng 4',
  'Tháng 5','Tháng 6','Tháng 7','Tháng 8',
  'Tháng 9','Tháng 10','Tháng 11','Tháng 12',
];

const YEAR_PAGE = 12; // years shown per page in year-picker

type CalView = 'day' | 'month' | 'year';

function pad(n: number) { return String(n).padStart(2, '0'); }
function toDateStr(y: number, m: number, d: number) { return `${y}-${pad(m + 1)}-${pad(d)}`; }
function formatDisplay(d: string) {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
}

export default function DatePicker({
  value, onChange, placeholder = 'Chọn ngày', min,
  label, icon, rangeStart, rangeEnd, align = 'left',
}: Props) {
  const today = new Date().toISOString().split('T')[0];

  const getInitialMonth = () => {
    const src = value || min || today;
    const [y, m] = src.split('-');
    return { year: parseInt(y), month: parseInt(m) - 1 };
  };

  const [open, setOpen]           = useState(false);
  const { year: iy, month: im }   = getInitialMonth();
  const [viewYear, setViewYear]   = useState(iy);
  const [viewMonth, setViewMonth] = useState(im);
  const [hoverDate, setHoverDate] = useState<string | null>(null);
  const [calView, setCalView]     = useState<CalView>('day');
  // year-picker: first year in the current page
  const [yearPageStart, setYearPageStart] = useState(() => Math.floor(iy / YEAR_PAGE) * YEAR_PAGE);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setHoverDate(null);
        setCalView('day');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Sync view when reopened
  useEffect(() => {
    if (open && value) {
      const [y, m] = value.split('-');
      const yr = parseInt(y), mo = parseInt(m) - 1;
      setViewYear(yr);
      setViewMonth(mo);
      setYearPageStart(Math.floor(yr / YEAR_PAGE) * YEAR_PAGE);
      setCalView('day');
    }
  }, [open]);

  /* ── navigation helpers ── */
  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  };

  const handleDay = (day: number) => {
    const d = toDateStr(viewYear, viewMonth, day);
    if (min && d < min) return;
    onChange(d);
    setOpen(false);
    setHoverDate(null);
    setCalView('day');
  };

  const handleMonthSelect = (m: number) => {
    setViewMonth(m);
    setCalView('day');
  };

  const handleYearSelect = (y: number) => {
    setViewYear(y);
    setYearPageStart(Math.floor(y / YEAR_PAGE) * YEAR_PAGE);
    setCalView('month');
  };

  /* ── calendar grid ── */
  const firstDow   = new Date(viewYear, viewMonth, 1).getDay();
  const offset     = (firstDow + 6) % 7;
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  const cells: (number | null)[] = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const getCellDate = (day: number) => toDateStr(viewYear, viewMonth, day);

  const isInRange = (d: string) => {
    const rs = rangeStart, re = rangeEnd || hoverDate;
    if (!rs || !re) return false;
    const low = rs < re ? rs : re, high = rs < re ? re : rs;
    return d > low && d < high;
  };
  const isRangeEdge = (d: string) => d === rangeStart || d === rangeEnd;

  /* ── year picker page ── */
  const yearPageEnd = yearPageStart + YEAR_PAGE - 1;

  return (
    <div className="relative" ref={ref}>
      {label && (
        <label className="block text-xs font-semibold text-stone uppercase tracking-wide mb-1.5">
          {label}
        </label>
      )}

      {/* Trigger */}
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
        <span className="text-stone flex-shrink-0">
          {icon ?? <CalendarDays size={15} />}
        </span>
        <span className={`flex-1 font-medium ${value ? 'text-ink' : 'text-stone'}`}>
          {value ? formatDisplay(value) : placeholder}
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

      {/* Dropdown */}
      {open && (
        <div
          className={`
            absolute top-[calc(100%+8px)] z-50 bg-white rounded-2xl shadow-2xl
            border border-sand p-4 w-72
            ${align === 'right' ? 'right-0' : 'left-0'}
          `}
          style={{ animation: 'dropIn 0.15s ease-out' }}
        >

          {/* ═══════════════ DAY VIEW ═══════════════ */}
          {calView === 'day' && (
            <>
              {/* Header */}
              <div className="flex items-center justify-between mb-3">
                <button
                  type="button"
                  onClick={prevMonth}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-stone hover:text-ink hover:bg-parchment transition-colors"
                >
                  <ChevronLeft size={15} />
                </button>

                <div className="flex items-center gap-1">
                  {/* Month button → month picker */}
                  <button
                    type="button"
                    onClick={() => setCalView('month')}
                    className="px-2 py-1 rounded-lg hover:bg-parchment transition-colors text-sm font-semibold text-ink"
                  >
                    {MONTHS_FULL[viewMonth]}
                  </button>
                  {/* Year button → year picker */}
                  <button
                    type="button"
                    onClick={() => { setYearPageStart(Math.floor(viewYear / YEAR_PAGE) * YEAR_PAGE); setCalView('year'); }}
                    className="px-2 py-1 rounded-lg hover:bg-terra-pale transition-colors text-sm font-bold text-terra-dark"
                  >
                    {viewYear}
                  </button>
                </div>

                <button
                  type="button"
                  onClick={nextMonth}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-stone hover:text-ink hover:bg-parchment transition-colors"
                >
                  <ChevronRight size={15} />
                </button>
              </div>

              {/* Weekday headers */}
              <div className="grid grid-cols-7 mb-1">
                {WEEKDAYS.map((d, i) => (
                  <div key={d} className={`text-center text-xs font-semibold py-1 ${i >= 5 ? 'text-wine' : 'text-stone'}`}>
                    {d}
                  </div>
                ))}
              </div>

              {/* Days grid */}
              <div className="grid grid-cols-7">
                {cells.map((day, idx) => {
                  if (day === null) return <div key={`e${idx}`} className="h-9" />;

                  const d = getCellDate(day);
                  const isSelected = d === value;
                  const isToday    = d === today;
                  const disabled   = !!(min && d < min);
                  const inRange    = isInRange(d);
                  const isEdge     = isRangeEdge(d);
                  const isWeekend  = idx % 7 >= 5;
                  const colIdx     = idx % 7;
                  const isRangeFirst = inRange && colIdx === 0;
                  const isRangeLast  = inRange && colIdx === 6;

                  return (
                    <div key={day} className="relative h-9 flex items-center justify-center">
                      {inRange && (
                        <div className={`absolute inset-y-1 bg-terra-pale ${
                          isRangeFirst ? 'left-0 rounded-l-full' :
                          isRangeLast  ? 'right-0 rounded-r-full' : 'inset-x-0'
                        }`} />
                      )}
                      {isEdge && d === rangeStart && rangeEnd && (
                        <div className="absolute inset-y-1 right-0 w-1/2 bg-terra-pale" />
                      )}
                      {isEdge && d === rangeEnd && rangeStart && (
                        <div className="absolute inset-y-1 left-0 w-1/2 bg-terra-pale" />
                      )}
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => handleDay(day)}
                        onMouseEnter={() => !disabled && setHoverDate(d)}
                        onMouseLeave={() => setHoverDate(null)}
                        className={`
                          relative z-10 w-8 h-8 rounded-full text-sm font-medium
                          transition-all duration-100 flex items-center justify-center
                          ${disabled ? 'opacity-25 cursor-not-allowed' : 'cursor-pointer'}
                          ${isSelected || isEdge
                            ? 'bg-terra text-white shadow-md shadow-blue-200 scale-105'
                            : inRange
                            ? 'text-terra-dark hover:bg-terra-pale'
                            : disabled
                            ? 'text-stone'
                            : isWeekend
                            ? 'text-wine hover:bg-wine-pale'
                            : 'text-ink hover:bg-parchment'
                          }
                        `}
                      >
                        {day}
                        {isToday && !isSelected && !isEdge && (
                          <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-terra" />
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Footer */}
              <div className="mt-2 pt-2.5 border-t border-sand flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => { if (min && today < min) return; onChange(today); setOpen(false); }}
                  className="text-xs font-semibold text-terra hover:text-terra-dark transition-colors px-2 py-1 rounded-lg hover:bg-terra-pale"
                >
                  Hôm nay
                </button>
                {value && (
                  <button
                    type="button"
                    onClick={() => { onChange(''); setOpen(false); }}
                    className="text-xs font-medium text-stone hover:text-wine transition-colors px-2 py-1 rounded-lg hover:bg-wine-pale"
                  >
                    Xóa ngày
                  </button>
                )}
              </div>
            </>
          )}

          {/* ═══════════════ MONTH VIEW ═══════════════ */}
          {calView === 'month' && (
            <>
              {/* Header */}
              <div className="flex items-center justify-between mb-4">
                <button
                  type="button"
                  onClick={() => setViewYear(y => y - 1)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-stone hover:text-ink hover:bg-parchment transition-colors"
                >
                  <ChevronLeft size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => { setYearPageStart(Math.floor(viewYear / YEAR_PAGE) * YEAR_PAGE); setCalView('year'); }}
                  className="px-3 py-1 rounded-lg hover:bg-terra-pale transition-colors text-sm font-bold text-terra-dark"
                >
                  {viewYear}
                </button>
                <button
                  type="button"
                  onClick={() => setViewYear(y => y + 1)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-stone hover:text-ink hover:bg-parchment transition-colors"
                >
                  <ChevronRight size={15} />
                </button>
              </div>

              {/* Month grid — 4 × 3 */}
              <div className="grid grid-cols-4 gap-1.5">
                {MONTHS_SHORT.map((name, i) => {
                  const isCurrentMonth = i === viewMonth;
                  const isValueMonth   = value
                    ? parseInt(value.split('-')[1]) - 1 === i && parseInt(value.split('-')[0]) === viewYear
                    : false;
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => handleMonthSelect(i)}
                      className={`
                        h-10 rounded-xl text-sm font-semibold transition-all
                        ${isValueMonth
                          ? 'bg-terra text-white shadow-md shadow-blue-200'
                          : isCurrentMonth
                          ? 'bg-terra-pale text-terra-dark ring-1 ring-terra/25'
                          : 'text-stone hover:bg-parchment'
                        }
                      `}
                    >
                      {name}
                    </button>
                  );
                })}
              </div>

              {/* Back link */}
              <div className="mt-3 pt-2.5 border-t border-sand text-center">
                <button
                  type="button"
                  onClick={() => setCalView('day')}
                  className="text-xs font-semibold text-stone hover:text-stone transition-colors px-2 py-1 rounded-lg hover:bg-paper"
                >
                  ← Quay lại
                </button>
              </div>
            </>
          )}

          {/* ═══════════════ YEAR VIEW ═══════════════ */}
          {calView === 'year' && (
            <>
              {/* Header */}
              <div className="flex items-center justify-between mb-4">
                <button
                  type="button"
                  onClick={() => setYearPageStart(s => s - YEAR_PAGE)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-stone hover:text-ink hover:bg-parchment transition-colors"
                >
                  <ChevronLeft size={15} />
                </button>
                <span className="text-sm font-bold text-stone">
                  {yearPageStart} – {yearPageEnd}
                </span>
                <button
                  type="button"
                  onClick={() => setYearPageStart(s => s + YEAR_PAGE)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-stone hover:text-ink hover:bg-parchment transition-colors"
                >
                  <ChevronRight size={15} />
                </button>
              </div>

              {/* Year grid — 4 × 3 */}
              <div className="grid grid-cols-4 gap-1.5">
                {Array.from({ length: YEAR_PAGE }, (_, i) => yearPageStart + i).map(y => {
                  const isCurrentYear = y === viewYear;
                  const isValueYear   = value ? parseInt(value.split('-')[0]) === y : false;
                  return (
                    <button
                      key={y}
                      type="button"
                      onClick={() => handleYearSelect(y)}
                      className={`
                        h-10 rounded-xl text-sm font-semibold transition-all
                        ${isValueYear
                          ? 'bg-terra text-white shadow-md shadow-blue-200'
                          : isCurrentYear
                          ? 'bg-terra-pale text-terra-dark ring-1 ring-terra/25'
                          : 'text-stone hover:bg-parchment'
                        }
                      `}
                    >
                      {y}
                    </button>
                  );
                })}
              </div>

              {/* Back link */}
              <div className="mt-3 pt-2.5 border-t border-sand text-center">
                <button
                  type="button"
                  onClick={() => setCalView('month')}
                  className="text-xs font-semibold text-stone hover:text-stone transition-colors px-2 py-1 rounded-lg hover:bg-paper"
                >
                  ← Quay lại
                </button>
              </div>
            </>
          )}
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
