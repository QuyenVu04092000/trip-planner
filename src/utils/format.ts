// ── Date formatting ───────────────────────────────────────────────────────────

/** yyyy-mm-dd → dd/mm/yyyy */
export function fmtDay(d: string): string {
  if (!d) return '';
  const parts = d.split('-');
  if (parts.length < 3) return d;
  const [y, m, day] = parts;
  return `${day}/${m}/${y}`;
}

/** yyyy-mm-dd → dd/mm (short, no year — for filter chips) */
export function fmtDayShort(d: string): string {
  if (!d) return '';
  const parts = d.split('-');
  if (parts.length < 3) return d;
  const [, m, day] = parts;
  return `${day}/${m}`;
}

/** Format a date range for display. fallback shown when both dates are empty. */
export function formatDateRange(
  start: string,
  end: string,
  fallback = 'Chưa có ngày',
): string {
  if (!start && !end) return fallback;
  if (!start) return fmtDay(end);
  if (!end) return fmtDay(start);
  return `${fmtDay(start)} – ${fmtDay(end)}`;
}

/** Returns "N ngày" from two yyyy-mm-dd strings. */
export function getDays(start: string, end: string): string {
  if (!start || !end) return '';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const days = Math.round(ms / 86400000) + 1;
  return days > 0 ? `${days} ngày` : '';
}

// ── Countdown ────────────────────────────────────────────────────────────────

export type CountdownResult =
  | { type: 'upcoming'; days: number; label: string }
  | { type: 'today' }
  | { type: 'ongoing'; daysLeft: number }
  | { type: 'ended' }
  | { type: 'no-date' };

export function getCountdown(startDate?: string, endDate?: string): CountdownResult {
  if (!startDate) return { type: 'no-date' };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [sy, sm, sd] = startDate.split('-').map(Number);
  const start = new Date(sy, sm - 1, sd);
  const end = endDate
    ? (() => { const [ey, em, ed] = endDate.split('-').map(Number); return new Date(ey, em - 1, ed); })()
    : start;
  const daysToStart = Math.round((start.getTime() - today.getTime()) / 86400000);
  const daysToEnd   = Math.round((end.getTime()   - today.getTime()) / 86400000);
  if (daysToStart > 0)                      return { type: 'upcoming', days: daysToStart, label: `${daysToStart} ngày nữa` };
  if (daysToStart === 0 && daysToEnd >= 0)  return { type: 'today' };
  if (daysToEnd >= 0)                       return { type: 'ongoing', daysLeft: daysToEnd };
  return { type: 'ended' };
}

// ── Size / money formatting ───────────────────────────────────────────────────

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function parseCost(s: string): number {
  const n = parseFloat(s.replace(/[^\d.]/g, ''));
  return isNaN(n) ? 0 : n;
}

export function fmtMoney(n: number): string {
  return n.toLocaleString('vi-VN') + 'đ';
}
