// Supabase Edge Function: trip-push-notify
// Triggered from frontend when a trip date is changed, OR by cron daily.
// Checks if trip starts in 1, 3, or 7 days → sends push to all user's subscriptions.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3';

const VAPID_PUBLIC_KEY  = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!;
const VAPID_MAILTO      = Deno.env.get('VAPID_MAILTO') ?? 'mailto:admin@tripmemo.app';

webpush.setVapidDetails(VAPID_MAILTO, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const NOTIFY_DAYS = [0, 1, 3, 7]; // trigger on these days before start

function daysUntil(dateStr: string): number {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const [y, m, d] = dateStr.split('-').map(Number);
  const start = new Date(y, m - 1, d);
  return Math.round((start.getTime() - today.getTime()) / 86400000);
}

function buildMessage(days: number, emoji: string, tripName: string) {
  if (days === 0) return { title: 'TripMemo ✈️', body: `${emoji} ${tripName} bắt đầu hôm nay! Chúc chuyến đi vui vẻ 🎉` };
  if (days === 1) return { title: 'TripMemo ✈️', body: `${emoji} ${tripName} — còn đúng 1 ngày nữa là xuất phát!` };
  if (days === 3) return { title: 'TripMemo ✈️', body: `${emoji} ${tripName} — còn 3 ngày nữa, đã chuẩn bị chưa?` };
  if (days === 7) return { title: 'TripMemo ✈️', body: `${emoji} ${tripName} — còn 1 tuần nữa là đi rồi!` };
  return null;
}

Deno.serve(async (req) => {
  // Allow cron (GET) and frontend trigger (POST)
  const isCron = req.method === 'GET';

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  try {
    if (isCron) {
      // ── Cron mode: check ALL trips for ALL users ──────────────────────────
      const { data: trips, error } = await supabase
        .from('trips')
        .select('id, name, emoji, start_date, user_id')
        .not('start_date', 'is', null);

      if (error) throw error;

      for (const trip of trips ?? []) {
        const days = daysUntil(trip.start_date);
        if (!NOTIFY_DAYS.includes(days)) continue;

        const msg = buildMessage(days, trip.emoji, trip.name);
        if (!msg) continue;

        // Get subscriptions for this user
        const { data: subs } = await supabase
          .from('push_subscriptions')
          .select('endpoint, p256dh, auth_key')
          .eq('user_id', trip.user_id);

        for (const sub of subs ?? []) {
          try {
            await webpush.sendNotification(
              { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
              JSON.stringify({ ...msg, tag: `${trip.id}_d${days}` }),
            );
            console.log(`[cron] Sent push to ${sub.endpoint.slice(0, 60)}…`);
          } catch (pushErr: unknown) {
            const status = (pushErr as { statusCode?: number })?.statusCode;
            console.warn(`[cron] sendNotification failed (${status ?? '?'}):`, pushErr);
            // 410 Gone or 404 = subscription no longer valid → delete it
            if (status === 410 || status === 404) {
              await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
              console.log('[cron] Removed stale subscription:', sub.endpoint.slice(0, 60));
            }
          }
        }
      }

      return new Response(JSON.stringify({ ok: true, mode: 'cron' }), { status: 200 });

    } else {
      // ── Frontend trigger: check ONE trip for the current user ─────────────
      const authHeader = req.headers.get('Authorization') ?? '';
      const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
      if (!user) return new Response('Unauthorized', { status: 401 });

      const { tripId, tripName, emoji, startDate } = await req.json();
      const days = daysUntil(startDate);
      if (!NOTIFY_DAYS.includes(days)) {
        return new Response(JSON.stringify({ ok: true, skipped: true, days }), { status: 200 });
      }

      const msg = buildMessage(days, emoji, tripName);
      if (!msg) return new Response(JSON.stringify({ ok: true, skipped: true }), { status: 200 });

      const { data: subs } = await supabase
        .from('push_subscriptions')
        .select('endpoint, p256dh, auth_key')
        .eq('user_id', user.id);

      let sent = 0;
      for (const sub of subs ?? []) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
            JSON.stringify({ ...msg, tag: `${tripId}_d${days}` }),
          );
          sent++;
          console.log(`[trigger] Sent push to ${sub.endpoint.slice(0, 60)}…`);
        } catch (pushErr: unknown) {
          const status = (pushErr as { statusCode?: number })?.statusCode;
          console.warn(`[trigger] sendNotification failed (${status ?? '?'}):`, pushErr);
          if (status === 410 || status === 404) {
            await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
          }
        }
      }

      return new Response(JSON.stringify({ ok: true, sent, days }), { status: 200 });
    }

  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
