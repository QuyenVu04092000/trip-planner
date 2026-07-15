import { Capacitor, registerPlugin } from '@capacitor/core';
import type { Session } from '@supabase/supabase-js';
import type { Trip } from '../types';
import { supabase } from './supabase';

// ── Plugin interface ──────────────────────────────────────────────────────────
//
// KIẾN TRÚC (widget cấu hình chọn trip):
//   Người dùng long-press widget → chọn 1 trip. Widget TỰ fetch `widget-data?tripId=`
//   để lấy nội dung + ảnh nền của ĐÚNG trip đó. App chỉ:
//     • công bố DANH SÁCH trip (setWidgetTripList) → để picker liệt kê
//     • đẩy auth (setWidgetAuth) để widget gọi được edge function
//     • kích reload (reloadWidget) mỗi khi dữ liệu đổi → widget fetch lại
//   Không còn "trip gần nhất" và không còn app-đẩy-payload → không có race.

interface WidgetAuthPayload {
  supabaseUrl: string;
  anonKey: string;
  accessToken: string;
  refreshToken: string;
}

interface WidgetTripListItem {
  id: string;
  name: string;
  emoji: string;
}

interface WidgetBridgePlugin {
  setWidgetTripList(data: { trips: WidgetTripListItem[] }): Promise<void>;
  reloadWidget(): Promise<void>;
  setWidgetLoggedIn(): Promise<void>;
  setWidgetLoggedOut(): Promise<void>;
  readWidgetEcho(): Promise<{ echo: string; appHasGroup: boolean }>;
  setWidgetAuth(data: WidgetAuthPayload): Promise<void>;
  getWidgetAuth(): Promise<{ hasAuth: boolean; accessToken?: string; refreshToken?: string }>;
}

// registerPlugin is the correct Capacitor 6+ API for accessing native plugins.
// The old `window.Capacitor.Plugins.X` pattern no longer works in Capacitor 8.
const WidgetBridge = registerPlugin<WidgetBridgePlugin>('WidgetBridge');

// ── Trip list (nguồn cho picker cấu hình widget) ────────────────────────────
// Gọi mỗi khi tập trip đổi (tạo/xoá/sửa tên) — để danh sách trong "Chỉnh sửa
// Widget" luôn khớp. Trip bị xoá → biến khỏi danh sách → widget đang chọn nó sẽ
// hiện "Chưa chọn chuyến đi". Native cũng reload sau khi ghi danh sách.
export async function setWidgetTripList(trips: Trip[]): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await WidgetBridge.setWidgetTripList({
      trips: trips.map((t) => ({ id: t.id, name: t.name, emoji: t.emoji })),
    });
    console.log('[Widget] setWidgetTripList OK —', trips.length, 'trips');
  } catch (e) {
    console.error('[Widget] setWidgetTripList FAILED:', e);
  }
}

// Kích widget tự fetch lại (dữ liệu trong 1 trip đổi: hoạt động/chi tiêu/quỹ/ảnh).
export async function reloadWidget(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await WidgetBridge.reloadWidget();
    console.log('[Widget] reloadWidget OK');
  } catch (e) {
    console.error('[Widget] reloadWidget FAILED:', e);
  }
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
// echo="no_echo_yet"  → extension never ran OR can't access App Group (provisioning issue)
// echo="file_missing" → extension has App Group but widget_data.json not found
// echo="ok:..."       → extension read correctly — check widget rendering
export async function readWidgetEcho(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const result = await WidgetBridge.readWidgetEcho();
    console.log('[Widget Echo]', JSON.stringify(result));
    if (result.echo === 'no_echo_yet') {
      console.warn('[Widget Echo] ⚠️ Extension never wrote echo — check App Group provisioning in Xcode for TripWidgetExtension target');
    } else if (result.echo === 'file_missing') {
      console.warn('[Widget Echo] ⚠️ Extension has App Group access but widget file not found');
    } else if (result.echo.startsWith('ok:')) {
      console.log('[Widget Echo] ✅ Extension read file successfully:', result.echo);
    }
  } catch (e) {
    console.error('[Widget Echo] FAILED:', e);
  }
}
