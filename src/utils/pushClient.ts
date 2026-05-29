import { supabase } from './supabase';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string;

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr.buffer;
}

// ── Register service worker ───────────────────────────────────────────────────
export async function registerSW(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register(
      import.meta.env.BASE_URL + 'sw.js',
      { scope: import.meta.env.BASE_URL }
    );
    return reg;
  } catch (err) {
    console.error('SW registration failed:', err);
    return null;
  }
}

// ── Subscribe to push & save to Supabase ─────────────────────────────────────
export async function subscribeToPush(): Promise<boolean> {
  try {
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    const subscription = existing ?? await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });

    const { endpoint, keys } = subscription.toJSON() as {
      endpoint: string;
      keys: { p256dh: string; auth: string };
    };

    const { error } = await supabase.from('push_subscriptions').upsert({
      endpoint,
      p256dh: keys.p256dh,
      auth_key: keys.auth,
    }, { onConflict: 'endpoint' });

    if (error) throw error;
    return true;
  } catch (err) {
    console.error('Push subscribe failed:', err);
    return false;
  }
}

// ── Unsubscribe ───────────────────────────────────────────────────────────────
export async function unsubscribeFromPush(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    const { endpoint } = sub.toJSON() as { endpoint: string };
    await sub.unsubscribe();
    await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
  } catch (err) {
    console.error('Push unsubscribe failed:', err);
  }
}

// ── Check if currently subscribed ────────────────────────────────────────────
export async function getPushSubscriptionState(): Promise<'subscribed' | 'not-subscribed' | 'unsupported'> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported';
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return sub ? 'subscribed' : 'not-subscribed';
  } catch {
    return 'not-subscribed';
  }
}

// ── Trigger immediate push check via Edge Function ───────────────────────────
export async function triggerPushCheck(tripId: string, tripName: string, emoji: string, startDate: string): Promise<void> {
  try {
    await supabase.functions.invoke('trip-push-notify', {
      body: { tripId, tripName, emoji, startDate },
    });
  } catch (err) {
    console.error('Push trigger failed:', err);
  }
}
