import type { Activity } from '../types';

// Module-level map — persists across component remounts so timeouts survive
// navigation within the same tab / PWA session.
const pendingTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

const STORAGE_PREFIX = 'tripmemo_act_';

function notifiedKey(): string {
  return `${STORAGE_PREFIX}${new Date().toISOString().split('T')[0]}`;
}

function getNotified(): Set<string> {
  return new Set<string>(JSON.parse(localStorage.getItem(notifiedKey()) ?? '[]'));
}

function markNotified(id: string): void {
  const set = getNotified();
  set.add(id);
  localStorage.setItem(notifiedKey(), JSON.stringify([...set]));
}

/**
 * Schedule browser notifications for each activity that has both date and time set.
 * Fires at: activityTime - 60 min  and  activityTime - 15 min.
 *
 * Safe to call multiple times — skips ids that are already scheduled or already shown.
 * Does NOT require cleanup on unmount; timeouts keep running while tab/PWA is open.
 */
export function scheduleActivityNotifications(activities: Activity[]): void {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  const now = Date.now();
  const notified = getNotified();

  for (const act of activities) {
    if (!act.date || !act.time) continue;

    // Parse "HH:MM" — guard against blank or malformed strings
    const timeParts = act.time.split(':').map(Number);
    if (timeParts.length < 2 || timeParts.some(isNaN)) continue;
    const [h, m] = timeParts;

    const dateParts = act.date.split('-').map(Number);
    if (dateParts.length < 3 || dateParts.some(isNaN)) continue;
    const [y, mo, d] = dateParts;

    const actMs = new Date(y, mo - 1, d, h, m, 0, 0).getTime();

    for (const minutesBefore of [60, 15]) {
      const notifId = `act_${act.id}_${minutesBefore}m`;

      // Already shown today or already pending
      if (notified.has(notifId) || pendingTimeouts.has(notifId)) continue;

      const fireAt = actMs - minutesBefore * 60_000;
      const delay  = fireAt - now;

      // Passed already (or within 5 s — browser throttle too short)
      if (delay < 5_000) continue;

      const label = minutesBefore === 60 ? '1 tiếng' : '15 phút';
      const body  = act.address
        ? `⏰ Còn ${label} nữa: ${act.activity} — ${act.address}`
        : `⏰ Còn ${label} nữa: ${act.activity}`;

      const timeout = setTimeout(() => {
        try {
          new Notification('TripMemo ✈️', {
            body,
            tag:  notifId,
            icon: '/icon-192.svg',
          });
          markNotified(notifId);
        } catch {
          // Notification permission may have been revoked — ignore
        }
        pendingTimeouts.delete(notifId);
      }, delay);

      pendingTimeouts.set(notifId, timeout);
    }
  }
}

/** Cancel all pending activity notifications (call when user logs out). */
export function cancelActivityNotifications(): void {
  for (const t of pendingTimeouts.values()) clearTimeout(t);
  pendingTimeouts.clear();
}
