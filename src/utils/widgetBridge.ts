import { Capacitor, registerPlugin } from '@capacitor/core';
import type { Session } from '@supabase/supabase-js';
import type { Trip, TripExpense, TripFund, TripFundPayment, Activity, MediaItem } from '../types';
import { supabase } from './supabase';
import { fetchActivities, fetchExpenses, fetchFunds, fetchFundPayments, fetchMediaItems } from './db';

// ── Plugin interface ──────────────────────────────────────────────────────────

interface WidgetAuthPayload {
  supabaseUrl: string;
  anonKey: string;
  accessToken: string;
  refreshToken: string;
}

interface WidgetBridgePlugin {
  updateWidgetData(data: object): Promise<void>;
  setWidgetLoggedIn(): Promise<void>;
  setWidgetLoggedOut(): Promise<void>;
  readWidgetEcho(): Promise<{ echo: string; appHasGroup: boolean }>;
  setWidgetAuth(data: WidgetAuthPayload): Promise<void>;
  getWidgetAuth(): Promise<{ hasAuth: boolean; accessToken?: string; refreshToken?: string }>;
}

// registerPlugin is the correct Capacitor 6+ API for accessing native plugins.
// The old `window.Capacitor.Plugins.X` pattern no longer works in Capacitor 8.
const WidgetBridge = registerPlugin<WidgetBridgePlugin>('WidgetBridge');

// ── Payload type ──────────────────────────────────────────────────────────────

interface WidgetPayload {
  tripId: string;
  tripName: string;
  tripEmoji: string;
  startDate: string;
  endDate: string;
  daysLeft: number;
  status: 'upcoming' | 'ongoing' | 'past';
  todayActivities: string[];
  fundBalance: number;
  totalSpent: number;
  hasFund: boolean;
  backgroundImageUrl?: string;
}

// ── Exports ───────────────────────────────────────────────────────────────────

export async function updateWidgetFromTrip(params: {
  trip: Pick<Trip, 'id' | 'name' | 'emoji' | 'startDate' | 'endDate'>;
  activities: Activity[];
  expenses: TripExpense[];
  funds: TripFund[];
  fundPayments: TripFundPayment[];
  media?: MediaItem[];
}): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  const { trip, activities, expenses, funds, fundPayments, media } = params;

  const today = new Date();
  const todayStr = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0'),
  ].join('-');

  let status: 'upcoming' | 'ongoing' | 'past' = 'past';
  if (todayStr >= trip.startDate && todayStr <= trip.endDate) status = 'ongoing';
  else if (todayStr < trip.startDate) status = 'upcoming';

  const [sy, sm, sd] = trip.startDate.split('-').map(Number);
  const startLocal = new Date(sy, sm - 1, sd);
  const diffMs = startLocal.getTime() - new Date().setHours(0, 0, 0, 0);
  const daysLeft = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));

  const hasFund = funds.length > 0;
  const totalFund = funds.reduce((s, f) => {
    const paid = fundPayments.filter(p => p.fundId === f.id && p.paid).length;
    return s + paid * f.amountPerPerson;
  }, 0);
  const fundBalance = totalFund - expenses.filter(e => e.fundId).reduce((s, e) => s + e.amount, 0);
  const totalSpent  = expenses.reduce((s, e) => s + e.amount, 0);

  let backgroundImageUrl: string | undefined;
  if (media && media.length > 0) {
    const item = media[Math.floor(Math.random() * media.length)];
    backgroundImageUrl = item.thumbnailUrl ?? item.publicUrl;
  }

  const payload: WidgetPayload = {
    tripId: trip.id,
    tripName: trip.name,
    tripEmoji: trip.emoji,
    startDate: trip.startDate,
    endDate: trip.endDate,
    daysLeft,
    status,
    // Encode as "time\u0001name" (time may be empty), sorted by time. The widget
    // splits on \u0001 to render the time separately.
    todayActivities: activities
      .filter(a => a.date === todayStr)
      .sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'))
      .map(a => `${a.time || ''}\u0001${a.activity}`),
    fundBalance,
    totalSpent,
    hasFund,
    backgroundImageUrl,
  };

  console.log('[Widget] updateWidgetFromTrip — tripId:', trip.id, '| daysLeft:', daysLeft, '| hasFund:', hasFund);
  try {
    await WidgetBridge.updateWidgetData(payload);
    console.log('[Widget] updateWidgetData OK');
  } catch (e) {
    console.error('[Widget] updateWidgetData FAILED:', e);
  }
}

// ── Nearest-trip selection (must match the widget-data edge function) ─────────
// The widget always shows the "nearest" trip: ongoing → soonest upcoming →
// most recent past. Both the app fast-path and the edge function use this exact
// rule so they never disagree on WHICH trip to display.
export function findNearestTrip<T extends { startDate: string; endDate: string }>(
  trips: T[],
): T | null {
  if (trips.length === 0) return null;
  const now = new Date();
  const today = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
  const sorted = [...trips].sort((a, b) => a.startDate.localeCompare(b.startDate));
  return (
    sorted.find(t => t.startDate <= today && t.endDate >= today) ??
    sorted.find(t => t.startDate > today) ??
    sorted[sorted.length - 1]
  );
}

// Compute the nearest trip across ALL trips, fetch its data, and push it to the
// widget. Use this whenever the trip set or any trip's dates change, so the
// widget reflects the correct trip even when the edge function is unavailable.
export async function syncNearestTripToWidget(trips: Trip[]): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const nearest = findNearestTrip(trips);
  if (!nearest) return;
  const [activities, expenses, funds, fundPayments, media] = await Promise.all([
    fetchActivities(nearest.id).catch(() => [] as Activity[]),
    fetchExpenses(nearest.id).catch(() => [] as TripExpense[]),
    fetchFunds(nearest.id).catch(() => [] as TripFund[]),
    fetchFundPayments(nearest.id).catch(() => [] as TripFundPayment[]),
    fetchMediaItems(nearest.id).catch(() => [] as MediaItem[]),
  ]);
  await updateWidgetFromTrip({ trip: nearest, activities, expenses, funds, fundPayments, media });
}

export async function setWidgetLoggedIn(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await WidgetBridge.setWidgetLoggedIn();
    console.log('[Widget] setWidgetLoggedIn OK');
  } catch (e) {
    console.error('[Widget] setWidgetLoggedIn FAILED:', e);
  }
}

export async function setWidgetLoggedOut(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await WidgetBridge.setWidgetLoggedOut();
    console.log('[Widget] setWidgetLoggedOut OK');
  } catch (e) {
    console.error('[Widget] setWidgetLoggedOut FAILED:', e);
  }
}

// ── Self-fetch session sync ─────────────────────────────────────────────────
// The widget extension calls the `widget-data` edge function on its own so it
// stays fresh without the app being open. To do that it needs the Supabase URL,
// anon key and the user's tokens — persisted into the App Group via setWidgetAuth.

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// Push the current session tokens to the widget. Call on login + token refresh.
export async function syncWidgetAuth(session: Session | null): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  if (!session?.access_token || !session.refresh_token) return;
  try {
    await WidgetBridge.setWidgetAuth({
      supabaseUrl:  SUPABASE_URL,
      anonKey:      SUPABASE_ANON,
      accessToken:  session.access_token,
      refreshToken: session.refresh_token,
    });
    console.log('[Widget] syncWidgetAuth OK');
  } catch (e) {
    console.error('[Widget] syncWidgetAuth FAILED:', e);
  }
}

// On cold start the widget may have rotated the refresh token while the app was
// closed. The shared config file is the source of truth, so adopt its tokens
// before supabase-js tries to refresh with its (possibly stale) stored token.
// Returns true if a session was adopted.
export async function adoptWidgetAuth(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  try {
    const { hasAuth, accessToken, refreshToken } = await WidgetBridge.getWidgetAuth();
    if (!hasAuth || !accessToken || !refreshToken) return false;

    const { data } = await supabase.auth.getSession();
    // Already in sync — nothing to adopt.
    if (data.session?.refresh_token === refreshToken) return false;

    const { error } = await supabase.auth.setSession({
      access_token:  accessToken,
      refresh_token: refreshToken,
    });
    if (error) {
      console.warn('[Widget] adoptWidgetAuth setSession failed:', error.message);
      return false;
    }
    console.log('[Widget] adoptWidgetAuth — adopted widget-rotated session');
    return true;
  } catch (e) {
    console.error('[Widget] adoptWidgetAuth FAILED:', e);
    return false;
  }
}

// Reads the echo file that the widget extension writes after each getTimeline() call.
// Call this ~5 seconds after updateWidgetFromTrip to diagnose whether the extension
// can access the App Group and read widget_data.json.
// echo="no_echo_yet"  → extension never ran OR can't access App Group (provisioning issue)
// echo="file_missing" → extension has App Group but file not there yet
// echo="ok:..."       → extension read correctly — check widget rendering
export async function readWidgetEcho(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const result = await WidgetBridge.readWidgetEcho();
    console.log('[Widget Echo]', JSON.stringify(result));
    if (result.echo === 'no_echo_yet') {
      console.warn('[Widget Echo] ⚠️ Extension never wrote echo — check App Group provisioning in Xcode for TripWidgetExtension target');
    } else if (result.echo === 'file_missing') {
      console.warn('[Widget Echo] ⚠️ Extension has App Group access but widget_data.json not found');
    } else if (result.echo.startsWith('ok:')) {
      console.log('[Widget Echo] ✅ Extension read file successfully:', result.echo);
    }
  } catch (e) {
    console.error('[Widget Echo] FAILED:', e);
  }
}

// ── Legacy helper (kept for backward compat) ──────────────────────────────────

export function buildWidgetData(params: {
  trips: Array<{ id: string; name: string; emoji: string; startDate: string; endDate: string }>;
  activities: Array<{ date: string; activity: string }>;
  expenses: Array<{ amount: number; fundId?: string | null }>;
  funds: Array<{ id: string; amountPerPerson: number }>;
  fundPayments: Array<{ fundId: string; paid: boolean }>;
}): Omit<WidgetPayload, 'backgroundImageUrl'> | null {
  const today = new Date();
  const todayStr = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0'),
  ].join('-');

  const sorted = [...params.trips].sort((a, b) =>
    new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
  );
  const trip =
    sorted.find(t => t.startDate <= todayStr && t.endDate >= todayStr) ??
    sorted.find(t => t.startDate > todayStr) ??
    sorted[sorted.length - 1];
  if (!trip) return null;

  let status: 'upcoming' | 'ongoing' | 'past' = 'past';
  if (todayStr >= trip.startDate && todayStr <= trip.endDate) status = 'ongoing';
  else if (todayStr < trip.startDate) status = 'upcoming';

  const [ty, tm, td] = trip.startDate.split('-').map(Number);
  const diffMs = new Date(ty, tm - 1, td).getTime() - today.setHours(0, 0, 0, 0);
  const daysLeft = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  const hasFund = params.funds.length > 0;
  const totalFund = params.funds.reduce((s, f) => {
    const paid = params.fundPayments.filter(p => p.fundId === f.id && p.paid).length;
    return s + paid * f.amountPerPerson;
  }, 0);
  const fundBalance = totalFund - params.expenses.filter(e => e.fundId).reduce((s, e) => s + e.amount, 0);

  return {
    tripId: trip.id, tripName: trip.name, tripEmoji: trip.emoji,
    startDate: trip.startDate, endDate: trip.endDate,
    daysLeft, status,
    todayActivities: params.activities.filter(a => a.date === todayStr).map(a => a.activity),
    fundBalance, totalSpent: params.expenses.reduce((s, e) => s + e.amount, 0), hasFund,
  };
}
