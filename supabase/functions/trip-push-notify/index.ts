// Supabase Edge Function: trip-push-notify
// Triggered from frontend when a trip date is changed, OR by cron daily.
// Checks if trip starts in 1, 3, or 7 days → sends push to all user's subscriptions.

import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3";

const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_MAILTO =
  Deno.env.get("VAPID_MAILTO") ?? "mailto:admin@tripmemo.app";

webpush.setVapidDetails(VAPID_MAILTO, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const NOTIFY_DAYS = [0, 1, 3, 7]; // trigger on these days before start

function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [y, m, d] = dateStr.split("-").map(Number);
  const start = new Date(y, m - 1, d);
  return Math.round((start.getTime() - today.getTime()) / 86400000);
}

function buildMessage(days: number, emoji: string, tripName: string) {
  const title = `${emoji} ${tripName}`;
  if (days === 0)
    return {
      title,
      body: `Hôm nay là ngày xuất phát! Chúc chuyến đi vui vẻ 🎉`,
    };
  if (days === 1)
    return { title, body: `Còn đúng 1 ngày nữa là xuất phát rồi!` };
  if (days === 2) return { title, body: `Còn 2 ngày nữa, đã chuẩn bị chưa?` };
  if (days === 3) return { title, body: `Còn 3 ngày nữa, đã chuẩn bị chưa?` };
  if (days === 4) return { title, body: `Còn 4 ngày nữa, đã chuẩn bị chưa?` };
  if (days === 5) return { title, body: `Còn 5 ngày nữa, đã chuẩn bị chưa?` };
  if (days === 6) return { title, body: `Còn 6 ngày nữa, đã chuẩn bị chưa?` };
  if (days === 7) return { title, body: `Còn 1 tuần nữa là đi rồi!` };
  return null;
}

async function sendToSub(
  supabase: ReturnType<typeof createClient>,
  sub: { endpoint: string; p256dh: string; auth_key: string },
  payload: object,
): Promise<"sent" | "stale" | "error"> {
  try {
    await webpush.sendNotification(
      {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth_key },
      },
      JSON.stringify(payload),
    );
    console.log(`[push] OK → ${sub.endpoint.slice(0, 70)}…`);
    return "sent";
  } catch (err: unknown) {
    const status = (err as { statusCode?: number })?.statusCode;
    console.warn(
      `[push] FAIL (HTTP ${status ?? "?"}) → ${sub.endpoint.slice(0, 70)}…`,
      err,
    );
    if (status === 410 || status === 404) {
      await supabase
        .from("push_subscriptions")
        .delete()
        .eq("endpoint", sub.endpoint);
      console.log("[push] Stale subscription removed.");
      return "stale";
    }
    return "error";
  }
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    // ── TEST mode: POST /trip-push-notify?test=1 ─────────────────────────────
    // Sends an immediate test push to ALL subscriptions of the authenticated user
    // regardless of trip dates. Useful for debugging.
    if (req.method === "POST" && url.searchParams.get("test") === "1") {
      const authHeader = req.headers.get("Authorization") ?? "";
      const {
        data: { user },
      } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
      if (!user) return new Response("Unauthorized", { status: 401 });

      const { data: subs } = await supabase
        .from("push_subscriptions")
        .select("endpoint, p256dh, auth_key")
        .eq("user_id", user.id);

      let sent = 0;
      for (const sub of subs ?? []) {
        const result = await sendToSub(supabase, sub, {
          title: "TripMemo ✈️ — Test Push",
          body: "Push notification đang hoạt động tốt! 🎉",
          tag: "test-push",
        });
        if (result === "sent") sent++;
      }
      return new Response(
        JSON.stringify({
          ok: true,
          mode: "test",
          sent,
          total: subs?.length ?? 0,
        }),
        { status: 200 },
      );
    }

    // ── Cron mode: GET ────────────────────────────────────────────────────────
    if (req.method === "GET") {
      const { data: trips, error } = await supabase
        .from("trips")
        .select("id, name, emoji, start_date, user_id")
        .not("start_date", "is", null);

      if (error) throw error;

      let totalSent = 0;
      const details: string[] = [];

      for (const trip of trips ?? []) {
        const days = daysUntil(trip.start_date);
        console.log(
          `[cron] "${trip.name}" start_date=${trip.start_date} days=${days}`,
        );
        if (!NOTIFY_DAYS.includes(days)) continue;

        const msg = buildMessage(days, trip.emoji, trip.name);
        if (!msg) continue;

        // Get ALL members of this trip (owner + invited members)
        const { data: members } = await supabase
          .from("trip_members")
          .select("user_id")
          .eq("trip_id", trip.id);

        const memberIds = (members ?? []).map((m: { user_id: string }) => m.user_id);
        // Fallback: always include the trip owner even if trip_members is empty
        if (!memberIds.includes(trip.user_id)) memberIds.push(trip.user_id);

        console.log(
          `[cron] "${trip.name}" → ${memberIds.length} member(s), days=${days}`,
        );

        for (const userId of memberIds) {
          const { data: subs } = await supabase
            .from("push_subscriptions")
            .select("endpoint, p256dh, auth_key")
            .eq("user_id", userId);

          for (const sub of subs ?? []) {
            const result = await sendToSub(supabase, sub, {
              ...msg,
              tag: `${trip.id}_d${days}`,
            });
            if (result === "sent") {
              totalSent++;
              details.push(`✓ ${trip.name} (${days}d)`);
            }
          }
        }
      }

      return new Response(
        JSON.stringify({ ok: true, mode: "cron", sent: totalSent, details }),
        { status: 200 },
      );
    }

    // ── Frontend trigger: POST ────────────────────────────────────────────────
    if (req.method === "POST") {
      const authHeader = req.headers.get("Authorization") ?? "";
      const {
        data: { user },
      } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
      if (!user) return new Response("Unauthorized", { status: 401 });

      const { tripId, tripName, emoji, startDate } = await req.json();
      const days = daysUntil(startDate);

      if (!NOTIFY_DAYS.includes(days)) {
        return new Response(JSON.stringify({ ok: true, skipped: true, days }), {
          status: 200,
        });
      }

      const msg = buildMessage(days, emoji, tripName);
      if (!msg)
        return new Response(JSON.stringify({ ok: true, skipped: true }), {
          status: 200,
        });

      const { data: subs } = await supabase
        .from("push_subscriptions")
        .select("endpoint, p256dh, auth_key")
        .eq("user_id", user.id);

      let sent = 0;
      for (const sub of subs ?? []) {
        const result = await sendToSub(supabase, sub, {
          ...msg,
          tag: `${tripId}_d${days}`,
        });
        if (result === "sent") sent++;
      }

      return new Response(
        JSON.stringify({ ok: true, mode: "trigger", sent, days }),
        { status: 200 },
      );
    }

    return new Response("Method not allowed", { status: 405 });
  } catch (err) {
    console.error("[push] Unhandled error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
    });
  }
});
