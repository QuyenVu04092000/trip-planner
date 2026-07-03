// Supabase Edge Function: widget-data
// Called DIRECTLY by the iOS widget extension on each timeline refresh.
// Authenticated with the user's access token (verify_jwt is on by default), so
// RLS naturally scopes every query to the trips this user can see.
//
// Returns the same widget payload the app computes locally, so the widget stays
// fresh even when the app is never opened.
//
// Response shape MUST match WidgetPayloadFile in TripWidget.swift:
//   { isLoggedIn: boolean, trip: WidgetTripData | null }

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const VN_OFFSET_MS = 7 * 60 * 60 * 1000; // Asia/Ho_Chi_Minh (UTC+7)

// Today's date string in Vietnam local time (matches how the app computes it).
function vnTodayStr(): string {
  return new Date(Date.now() + VN_OFFSET_MS).toISOString().slice(0, 10);
}

function daysBetween(fromStr: string, toStr: string): number {
  const [fy, fm, fd] = fromStr.split("-").map(Number);
  const [ty, tm, td] = toStr.split("-").map(Number);
  const from = Date.UTC(fy, fm - 1, fd);
  const to = Date.UTC(ty, tm - 1, td);
  return Math.round((to - from) / 86_400_000);
}

// Signed URL ảnh nền cho widget (bucket private). TTL dài để không gãy giữa các
// lần widget refresh. Ký bằng service role.
async function mediaBackgroundUrl(
  admin: ReturnType<typeof createClient>,
  row: { storage_path?: string; thumbnail_path?: string; type?: string } | undefined,
): Promise<string | undefined> {
  if (!row) return undefined;
  const TTL = 24 * 60 * 60; // 24h
  if (row.type === "video" && row.thumbnail_path) {
    const { data } = await admin.storage.from("trip-media").createSignedUrl(row.thumbnail_path, TTL);
    return data?.signedUrl ?? undefined;
  }
  if (row.storage_path) {
    const { data } = await admin.storage.from("trip-media").createSignedUrl(row.storage_path, TTL, {
      transform: { width: 800, quality: 70, resize: "contain" },
    });
    return data?.signedUrl ?? undefined;
  }
  return undefined;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "").trim();
  if (!token) return json({ isLoggedIn: false, trip: null }, 401);

  // Client acts AS the user — RLS scopes every query automatically.
  const supabase = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData } = await supabase.auth.getUser(token);
  const user = userData.user;
  if (!user) return json({ isLoggedIn: false, trip: null }, 401);

  try {
    // ── 1. All trips the user can access (own + shared) ──────────────────────
    const { data: ownTrips } = await supabase
      .from("trips")
      .select("id, name, emoji, start_date, end_date, user_id")
      .eq("user_id", user.id);

    const { data: memberRows } = await supabase
      .from("trip_members")
      .select("trip_id")
      .eq("user_id", user.id)
      .eq("role", "member");

    const sharedIds = (memberRows ?? []).map((r: { trip_id: string }) => r.trip_id);
    let sharedTrips: Record<string, unknown>[] = [];
    if (sharedIds.length > 0) {
      const { data } = await supabase
        .from("trips")
        .select("id, name, emoji, start_date, end_date, user_id")
        .in("id", sharedIds);
      sharedTrips = data ?? [];
    }

    const tripMap = new Map<string, Record<string, unknown>>();
    for (const t of [...(ownTrips ?? []), ...sharedTrips]) {
      tripMap.set(t.id as string, t);
    }
    const trips = [...tripMap.values()].filter((t) => t.start_date && t.end_date);

    if (trips.length === 0) return json({ isLoggedIn: true, trip: null });

    // ── 2. Pick the "nearest" trip (ongoing → next upcoming → last past) ─────
    const today = vnTodayStr();
    const sorted = [...trips].sort(
      (a, b) => String(a.start_date).localeCompare(String(b.start_date)),
    );
    const nearest =
      sorted.find((t) => String(t.start_date) <= today && String(t.end_date) >= today) ??
      sorted.find((t) => String(t.start_date) > today) ??
      sorted[sorted.length - 1];

    const tripId = nearest.id as string;
    const startDate = nearest.start_date as string;
    const endDate = nearest.end_date as string;

    // ── 3. Aggregate funds / expenses / activities / media in parallel ───────
    const [funds, fundPayments, expenses, activities, media] = await Promise.all([
      supabase.from("trip_funds").select("id, amount_per_person").eq("trip_id", tripId),
      supabase.from("trip_fund_payments").select("fund_id, paid").eq("trip_id", tripId),
      supabase.from("trip_expenses").select("amount, fund_id").eq("trip_id", tripId),
      supabase
        .from("activities")
        .select("activity, date, time, position")
        .eq("trip_id", tripId)
        .order("date")
        .order("position")
        .order("time"),
      supabase
        .from("media_items")
        .select("storage_path, thumbnail_path, type, created_at")
        .eq("trip_id", tripId),
    ]);

    const fundRows = funds.data ?? [];
    const paymentRows = fundPayments.data ?? [];
    const expenseRows = expenses.data ?? [];

    const hasFund = fundRows.length > 0;
    const totalFund = fundRows.reduce((s: number, f: { id: string; amount_per_person: number }) => {
      const paidCount = paymentRows.filter(
        (p: { fund_id: string; paid: boolean }) => p.fund_id === f.id && p.paid,
      ).length;
      return s + paidCount * Number(f.amount_per_person);
    }, 0);
    const fundSpent = expenseRows
      .filter((e: { fund_id?: string | null }) => e.fund_id)
      .reduce((s: number, e: { amount: number }) => s + Number(e.amount), 0);
    const fundBalance = totalFund - fundSpent;
    const totalSpent = expenseRows.reduce(
      (s: number, e: { amount: number }) => s + Number(e.amount),
      0,
    );

    // Gom hoạt động theo TỪNG NGÀY → schedule["yyyy-MM-dd"] = ["time\u0001name"].
    // Widget dùng map này để hiện đúng lịch mỗi ngày khi countdown sang ngày mới
    // mà app không mở. Mỗi entry mã hoá "time\u0001name" (widget tách trên \u0001).
    const schedule: Record<string, string[]> = {};
    for (
      const a of (activities.data ?? []) as {
        activity?: string;
        date?: string;
        time?: string;
      }[]
    ) {
      if (!a.activity || !a.date) continue;
      (schedule[a.date] ??= []).push(`${a.time || ""}\u0001${a.activity}`);
    }
    for (const d of Object.keys(schedule)) {
      schedule[d].sort((x, y) =>
        (x.split("\u0001")[0] || "99:99").localeCompare(y.split("\u0001")[0] || "99:99")
      );
    }
    const todayActivities = schedule[today] ?? [];

    // Deterministic daily rotation so the bg only changes once per day (not every refresh).
    let backgroundImageUrl: string | undefined;
    const mediaRows = media.data ?? [];
    if (mediaRows.length > 0) {
      const dayOfYear = Math.floor(
        (Date.now() + VN_OFFSET_MS) / 86_400_000,
      );
      const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      backgroundImageUrl = await mediaBackgroundUrl(admin, mediaRows[dayOfYear % mediaRows.length]);
    }

    // ── 4. Countdown + status ────────────────────────────────────────────────
    const daysLeft = Math.max(0, daysBetween(today, startDate));
    let status: "upcoming" | "ongoing" | "past" = "past";
    if (today >= startDate && today <= endDate) status = "ongoing";
    else if (today < startDate) status = "upcoming";

    return json({
      isLoggedIn: true,
      trip: {
        tripId,
        tripName: (nearest.name as string) ?? "",
        tripEmoji: (nearest.emoji as string) ?? "✈️",
        startDate,
        endDate,
        daysLeft,
        status,
        todayActivities,
        schedule,
        fundBalance,
        totalSpent,
        hasFund,
        backgroundImageUrl,
      },
    });
  } catch (err) {
    console.error("[widget-data] error:", err);
    return json({ error: String(err) }, 500);
  }
});
