// Supabase Edge Function: send-activity-reminders
// Called by pg_cron every 5 minutes.
// Sends push notifications to all trip members for activities starting in:
//   - 55–65 minutes  → "Còn 1 tiếng nữa"
//   - 25–35 minutes  → "Còn 30 phút nữa"
//   - 10–20 minutes  → "Còn 15 phút nữa"
//
// Activity date/time is stored in Vietnam local time (UTC+7).

import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3";

const VAPID_PUBLIC_KEY  = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_MAILTO      = Deno.env.get("VAPID_MAILTO") ?? "mailto:admin@tripmemo.app";

webpush.setVapidDetails(VAPID_MAILTO, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

// ── Helpers ───────────────────────────────────────────────────────────────────

async function sendToSub(
  supabase: ReturnType<typeof createClient>,
  sub: { endpoint: string; p256dh: string; auth_key: string },
  payload: object,
): Promise<"sent" | "stale" | "error"> {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
      JSON.stringify(payload),
    );
    return "sent";
  } catch (err: unknown) {
    const status = (err as { statusCode?: number })?.statusCode;
    if (status === 410 || status === 404) {
      await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
      return "stale";
    }
    console.error("[activity-push] sendNotification error:", err);
    return "error";
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

Deno.serve(async (_req) => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Reminder windows (±5 phút quanh mốc; cron chạy mỗi 5 phút nên không lọt)
  const WINDOWS = [
    { low: 55, high: 65, label: "1 tiếng",  key: "60m" },
    { low: 25, high: 35, label: "30 phút",  key: "30m" },
    { low: 10, high: 20, label: "15 phút",  key: "15m" },
  ];

  let totalSent = 0;
  const details: string[] = [];

  for (const win of WINDOWS) {
    // Query activities whose local Vietnam time falls in [now+low, now+high]
    // (date || ' ' || time) is treated as Asia/Ho_Chi_Minh local datetime
    const { data: activities, error: actErr } = await supabase
      .from("activities")
      .select("id, trip_id, activity, address, date, time")
      .not("time", "is", null)
      .neq("time", "")
      .not("date", "is", null)
      .neq("date", "")
      .gte(
        // Supabase filter on computed column isn't possible, use rpc fallback below
        // We'll filter in JS after fetching today+tomorrow activities
        "date",
        new Date(Date.now() - 2 * 86400000).toISOString().split("T")[0],
      )
      .lte(
        "date",
        new Date(Date.now() + 2 * 86400000).toISOString().split("T")[0],
      );

    if (actErr) {
      console.error("[activity-push] fetch activities error:", actErr);
      continue;
    }

    // Filter: activity datetime (VN local = UTC+7) must be in [now+low, now+high]
    const nowMs   = Date.now();
    const lowMs   = nowMs + win.low  * 60_000;
    const highMs  = nowMs + win.high * 60_000;

    const matching = (activities ?? []).filter((act) => {
      if (!act.date || !act.time) return false;
      const [h, m] = act.time.split(":").map(Number);
      if (isNaN(h) || isNaN(m)) return false;
      const [y, mo, d] = act.date.split("-").map(Number);
      // Treat date+time as UTC+7 local → convert to UTC ms
      const localMs = Date.UTC(y, mo - 1, d, h - 7, m); // subtract 7h to get UTC
      return localMs >= lowMs && localMs <= highMs;
    });

    for (const act of matching) {
      // Get all members of this trip
      const { data: members } = await supabase
        .from("trip_members")
        .select("user_id")
        .eq("trip_id", act.trip_id);

      for (const member of members ?? []) {
        // Get push subscriptions for this user
        const { data: subs } = await supabase
          .from("push_subscriptions")
          .select("endpoint, p256dh, auth_key")
          .eq("user_id", member.user_id);

        for (const sub of subs ?? []) {
          const result = await sendToSub(supabase, sub, {
            title: "TripMemo ✈️",
            body:  act.address
              ? `⏰ Còn ${win.label} nữa: ${act.activity} — ${act.address}`
              : `⏰ Còn ${win.label} nữa: ${act.activity}`,
            tag:   `act_${act.id}_${win.key}`,
          });
          if (result === "sent") {
            totalSent++;
            details.push(`✓ ${act.activity} (${win.label})`);
          }
        }
      }
    }
  }

  console.log(`[activity-push] done, sent=${totalSent}`, details);
  return new Response(
    JSON.stringify({ ok: true, sent: totalSent, details }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
