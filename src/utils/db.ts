import { supabase } from './supabase';
import { api } from './api';
import type { Trip, Activity, MediaItem, TripMember, TripInvite, TripExpense, TripFund, TripFundPayment, UserProfile, Suggestion } from '../types';
import exifr from 'exifr';


// ── Offline-first read cache (localStorage) ───────────────────────────────────
// Cache kết quả ĐỌC; khi mất mạng / fetch lỗi → trả cache (xem được offline,
// read-only). Ghi vẫn cần mạng.
function lsKey(name: string): string { return `tm_cache_${name}`; }

function readLS<T>(name: string): T | null {
  try {
    const v = localStorage.getItem(lsKey(name));
    return v ? (JSON.parse(v) as T) : null;
  } catch { return null; }
}

function writeLS(name: string, data: unknown): void {
  try { localStorage.setItem(lsKey(name), JSON.stringify(data)); } catch { /* quota */ }
}

async function cachedFetch<T>(name: string, fetcher: () => Promise<T>): Promise<T> {
  try {
    const data = await fetcher();
    writeLS(name, data);
    return data;
  } catch (err) {
    const cached = readLS<T>(name);
    if (cached !== null) {
      console.warn('[offline] dùng dữ liệu cache cho', name);
      return cached;
    }
    throw err;
  }
}

// ── In-memory cache for media (TTL 2 min) ─────────────────────────────────────

const mediaCache = new Map<string, { items: MediaItem[]; ts: number }>();
const CACHE_TTL = 120_000;

function getCached(tripId: string): MediaItem[] | null {
  const entry = mediaCache.get(tripId);
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.items;
  return null;
}

function setCache(tripId: string, items: MediaItem[]) {
  mediaCache.set(tripId, { items, ts: Date.now() });
}

export function invalidateMediaCache(tripId: string) {
  mediaCache.delete(tripId);
}

// ── URL helpers ───────────────────────────────────────────────────────────────

function getUrls(storagePath: string, type: 'image' | 'video') {
  if (!storagePath) return { publicUrl: undefined, thumbnailUrl: undefined };

  const publicUrl = supabase.storage.from('trip-media').getPublicUrl(storagePath).data.publicUrl;

  // Supabase image transforms: resize to thumbnail for display in grids/cards
  const thumbnailUrl = type === 'image'
    ? supabase.storage.from('trip-media').getPublicUrl(storagePath, {
        transform: { width: 800, quality: 75, resize: 'contain' },
      }).data.publicUrl
    : publicUrl;

  return { publicUrl, thumbnailUrl };
}

// ── Row mappers ───────────────────────────────────────────────────────────────

function rowToTrip(r: Record<string, unknown>): Trip {
  return {
    id: r.id as string,
    name: r.name as string,
    destination: (r.destination as string) ?? '',
    lat: (r.lat as number) ?? null,
    lon: (r.lon as number) ?? null,
    startDate: (r.start_date as string) ?? '',
    endDate: (r.end_date as string) ?? '',
    coverColor: (r.cover_color as string) ?? 'from-blue-400 to-indigo-600',
    emoji: (r.emoji as string) ?? '✈️',
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

function tripToRow(t: Trip) {
  return {
    id: t.id, name: t.name, destination: t.destination,
    lat: t.lat ?? null, lon: t.lon ?? null,
    start_date: t.startDate, end_date: t.endDate,
    cover_color: t.coverColor, emoji: t.emoji,
    created_at: t.createdAt, updated_at: t.updatedAt,
  };
}

function rowToMediaItem(r: Record<string, unknown>): MediaItem {
  const storagePath = (r.storage_path as string) ?? '';
  const thumbnailPath = (r.thumbnail_path as string) || undefined;
  const type = r.type as 'image' | 'video';

  // Edge Function (bucket private) đã ký sẵn signed URL → ƯU TIÊN dùng.
  // Chỉ fallback getUrls khi thiếu (vd dùng nội bộ ngoài luồng edge function).
  const fallback = getUrls(storagePath, type);
  const publicUrl = (r.publicUrl as string) ?? fallback.publicUrl;
  const thumbnailUrl = (r.thumbnailUrl as string) ?? fallback.thumbnailUrl;

  return {
    id: r.id as string,
    tripId: r.trip_id as string,
    type,
    name: (r.name as string) ?? '',
    size: (r.size as number) ?? 0,
    caption: (r.caption as string) ?? '',
    createdAt: r.created_at as string,
    takenAt: (r.taken_at as string) ?? undefined,
    storagePath,
    thumbnailPath,
    publicUrl,
    thumbnailUrl,
  };
}

// ── Trips ─────────────────────────────────────────────────────────────────────

export async function fetchTrips(): Promise<Trip[]> {
  return cachedFetch('trips', async () => {
    const rows = await api.get<Record<string, unknown>[]>('/trips');
    return rows.map(rowToTrip);
  });
}

export async function createTrip(trip: Trip): Promise<void> {
  await api.post('/trips', tripToRow(trip));
}

export async function updateTrip(trip: Trip): Promise<void> {
  await api.put('/trips', tripToRow(trip), { id: trip.id });
}

export async function deleteTrip(tripId: string): Promise<void> {
  invalidateMediaCache(tripId);
  await api.delete('/trips', { id: tripId });
}

// ── Activities ────────────────────────────────────────────────────────────────

function rowToActivity(r: Record<string, unknown>): Activity {
  return {
    id: r.id as string,
    tripId: r.trip_id as string,
    date: (r.date as string) ?? '',
    time: (r.time as string) ?? '',
    activity: (r.activity as string) ?? '',
    address: (r.address as string) ?? '',
    lat: (r.lat as number) ?? null,
    lon: (r.lon as number) ?? null,
    cost: (r.cost as string) ?? '',
    notes: (r.notes as string) ?? '',
    position: (r.position as number) ?? 0,
    createdAt: r.created_at as string,
  };
}

export async function fetchActivities(tripId: string): Promise<Activity[]> {
  return cachedFetch(`activities_${tripId}`, async () => {
    const rows = await api.get<Record<string, unknown>[]>('/activities', { tripId });
    return rows.map(rowToActivity);
  });
}

export async function createActivity(
  tripId: string,
  fields: Omit<Activity, 'id' | 'tripId' | 'createdAt'>,
): Promise<Activity> {
  const id = `act_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const row = {
    id, trip_id: tripId,
    date: fields.date, time: fields.time, activity: fields.activity,
    address: fields.address, lat: fields.lat ?? null, lon: fields.lon ?? null,
    cost: fields.cost, notes: fields.notes,
    position: fields.position,
  };
  const data = await api.post<Record<string, unknown>>('/activities', row);
  return rowToActivity(data);
}

// ── Gợi ý địa điểm (Gemini + Mapbox, cache phía server) ─────────────────────────
export async function fetchSuggestions(
  tripId: string,
  destination: string,
  refresh = false,
): Promise<Suggestion[]> {
  return api.post<Suggestion[]>('/suggestions', { tripId, destination, refresh });
}

export async function updateActivity(
  id: string,
  fields: Partial<Omit<Activity, 'id' | 'tripId' | 'createdAt'>>,
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (fields.date     !== undefined) row.date     = fields.date;
  if (fields.time     !== undefined) row.time     = fields.time;
  if (fields.activity !== undefined) row.activity = fields.activity;
  if (fields.address  !== undefined) row.address  = fields.address;
  if (fields.lat      !== undefined) row.lat      = fields.lat;
  if (fields.lon      !== undefined) row.lon      = fields.lon;
  if (fields.cost     !== undefined) row.cost     = fields.cost;
  if (fields.notes    !== undefined) row.notes    = fields.notes;
  if (fields.position !== undefined) row.position = fields.position;
  await api.put('/activities', row, { id });
}

export async function deleteActivity(id: string): Promise<void> {
  await api.delete('/activities', { id });
}

// ── Media ─────────────────────────────────────────────────────────────────────

export async function fetchMediaItems(tripId: string): Promise<MediaItem[]> {
  const cached = getCached(tripId);
  if (cached) return cached;

  const rows = await api.get<Record<string, unknown>[]>('/media', { tripId });
  // Edge Function returns rows with publicUrl + thumbnailUrl already computed
  const items = rows.map(r => rowToMediaItem(r));
  setCache(tripId, items);
  return items;
}

function localDateStr(dt: Date): string {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// QuickTime/MP4 epoch starts Jan 1, 1904 (not Unix epoch Jan 1, 1970)
const QT_EPOCH_OFFSET_S = 2082844800;

function readU32(buf: Uint8Array, off: number): number {
  return ((buf[off] << 24) | (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3]) >>> 0;
}

/**
 * Scan moov content for a UTF-8 'data' atom containing an ISO date string.
 *
 * Modern iPhone MOVs store the recording date in:
 *   moov → meta → ilst → item[N] → data atom  (com.apple.quicktime.creationdate)
 *
 * Older QuickTime MOVs store it in:
 *   moov → udta → ©day → data atom  (iTunes format)
 *
 * In both cases the leaf is a 'data' box:
 *   [4 size][4 'data'][4 type_indicator=1 (UTF-8)][4 locale=0][text…]
 *
 * We scan for that exact 12-byte signature then validate the text looks like a date.
 */
function parseQTDate(moovData: Uint8Array): Date | undefined {
  // Signature: 'data'(4) + type_indicator=1(4) + locale=0(4)
  // p points to the first byte of 'data' (= box offset +4, since size precedes it)
  for (let p = 4; p + 12 <= moovData.length; p++) {
    if (moovData[p]    !== 0x64) continue; // 'd'
    if (moovData[p+1]  !== 0x61) continue; // 'a'
    if (moovData[p+2]  !== 0x74) continue; // 't'
    if (moovData[p+3]  !== 0x61) continue; // 'a'
    if (moovData[p+4]  !== 0x00) continue;
    if (moovData[p+5]  !== 0x00) continue;
    if (moovData[p+6]  !== 0x00) continue;
    if (moovData[p+7]  !== 0x01) continue; // type_indicator = 1 (UTF-8)
    if (moovData[p+8]  !== 0x00) continue;
    if (moovData[p+9]  !== 0x00) continue;
    if (moovData[p+10] !== 0x00) continue;
    if (moovData[p+11] !== 0x00) continue; // locale = 0

    // Box size is 4 bytes before the type field
    const boxSize = readU32(moovData, p - 4);
    if (boxSize < 16 || boxSize > 300) continue;

    const textEnd = Math.min(p - 4 + boxSize, moovData.length);
    const text = new TextDecoder().decode(moovData.subarray(p + 12, textEnd)).trim();

    // Must look like a date: starts with YYYY-
    if (!/^\d{4}-/.test(text)) continue;
    console.warn('  QT data atom date:', JSON.stringify(text));

    // Normalize +0700 → +07:00 for strict ISO 8601 parsers
    const normalized = text.replace(/([+-])(\d{2})(\d{2})$/, '$1$2:$3');
    const dt = new Date(normalized);
    if (!isNaN(dt.getTime()) && dt.getFullYear() >= 1990) return dt;
  }
  return undefined;
}

async function extractVideoDate(file: File): Promise<Date | undefined> {
  try {
    // Step 1: scan top-level box headers (8 bytes each) to find exact moov offset.
    // Typical MOV: ftyp → wide → mdat (huge) → moov
    // Typical MP4 fast-start: ftyp → moov → mdat
    let pos = 0;
    let moovOffset = -1;
    let moovSize = 0;

    console.warn('[extractVideoDate]', file.name, 'size:', file.size);
    while (pos + 8 <= file.size) {
      const hdr = new Uint8Array(await file.slice(pos, pos + 8).arrayBuffer());
      let size = readU32(hdr, 0);
      const type = String.fromCharCode(hdr[4], hdr[5], hdr[6], hdr[7]);

      // size=1 means 64-bit extended size in next 8 bytes (ISO BMFF largesize)
      if (size === 1) {
        if (pos + 16 > file.size) break;
        const ext = new Uint8Array(await file.slice(pos + 8, pos + 16).arrayBuffer());
        const hi = readU32(ext, 0);
        size = hi === 0 ? readU32(ext, 4) : 0; // skip if >4GB
      }

      console.warn('  box:', type, 'size:', size, 'at:', pos);
      if (type === 'moov') { moovOffset = pos; moovSize = size; break; }
      if (size < 8) { console.warn('  → bad size, stop'); break; }
      pos += size;
    }

    if (moovOffset === -1) { console.warn('  → moov not found'); return undefined; }

    const moovContentStart = moovOffset + 8;
    const moovContentEnd   = moovOffset + moovSize;
    console.warn('  moov content size:', moovSize - 8);

    // Step 2: read TAIL of moov (up to 128 KB) — udta is always the last child of moov
    const tailBytes  = Math.min(131_072, moovSize - 8);
    const tailOffset = moovContentEnd - tailBytes;
    const moovTail   = new Uint8Array(await file.slice(tailOffset, moovContentEnd).arrayBuffer());

    // Step 3: prefer metadata date — Photos Library rewrites mvhd.creation_time on export
    const metaDate = parseQTDate(moovTail);
    console.warn('  QT meta date:', metaDate?.toISOString() ?? 'not found');
    if (metaDate) return metaDate;

    // Step 4: fall back to mvhd.creation_time — mvhd is always the FIRST child of moov
    const headBytes = Math.min(256, moovSize - 8);
    const moovHead  = new Uint8Array(await file.slice(moovContentStart, moovContentStart + headBytes).arrayBuffer());
    let i = 0;
    while (i + 8 <= moovHead.length) {
      const size = readU32(moovHead, i);
      const type = String.fromCharCode(moovHead[i+4], moovHead[i+5], moovHead[i+6], moovHead[i+7]);
      if (type === 'mvhd' && i + 24 <= moovHead.length) {
        const version = moovHead[i + 8];
        const qtSecs = version === 1 ? readU32(moovHead, i + 20) : readU32(moovHead, i + 12);
        const dt = new Date((qtSecs - QT_EPOCH_OFFSET_S) * 1000);
        console.warn('  mvhd fallback:', dt.toISOString());
        if (qtSecs > 0 && !isNaN(dt.getTime()) && dt.getFullYear() >= 1990) return dt;
        break;
      }
      if (size < 8) break;
      i += size;
    }
  } catch { /* ignore */ }
  return undefined;
}

export async function extractTakenAt(file: File): Promise<string | undefined> {
  console.warn('[extractTakenAt]', file.name, '| type:', file.type, '| size:', file.size, '| lastModified:', new Date(file.lastModified).toISOString());
  // Images: EXIF is most accurate
  if (file.type.startsWith('image/')) {
    try {
      const exif = await exifr.parse(file, { pick: ['DateTimeOriginal', 'CreateDate', 'DateTime'] });
      const dt: Date | undefined = exif?.DateTimeOriginal ?? exif?.CreateDate ?? exif?.DateTime;
      if (dt instanceof Date && !isNaN(dt.getTime())) return localDateStr(dt);
    } catch { /* fall through */ }
  }

  // Videos: parse QuickTime/MP4 mvhd atom for actual recording date
  if (file.type.startsWith('video/')) {
    const dt = await extractVideoDate(file);
    if (dt) return localDateStr(dt);
  }

  // Last resort: file.lastModified (unreliable for Photos Library exports)
  if (file.lastModified) {
    const dt = new Date(file.lastModified);
    if (dt.getFullYear() >= 1990) return localDateStr(dt);
  }

  return undefined;
}

// ── Video thumbnail ───────────────────────────────────────────────────────────

async function generateVideoThumbnail(file: File): Promise<Blob | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    video.src = url;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';

    video.onloadedmetadata = () => {
      // Seek to 0.5s or middle of video for a representative frame
      video.currentTime = Math.min(0.5, video.duration / 2);
    };

    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas');
        const maxW = 800;
        const ratio = Math.min(maxW / video.videoWidth, 1);
        canvas.width  = Math.round(video.videoWidth  * ratio);
        canvas.height = Math.round(video.videoHeight * ratio);
        canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.8);
      } catch {
        URL.revokeObjectURL(url);
        resolve(null);
      }
    };

    video.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    video.load();
  });
}

// ── Upload ────────────────────────────────────────────────────────────────────

export async function uploadMedia(
  tripId: string,
  file: File,
  takenAt?: string,
  /** Original file metadata (name + size before compression) for DB storage and dedup fingerprinting */
  originalMeta?: { name: string; size: number },
): Promise<MediaItem> {
  const ext = file.name.split('.').pop() ?? '';
  const id = `media_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const storagePath = `${tripId}/${id}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from('trip-media').upload(storagePath, file, { upsert: false });
  if (uploadError) throw uploadError;

  const type: 'image' | 'video' = file.type.startsWith('image/') ? 'image' : 'video';
  // Preview tức thời bằng object URL local (bucket private không cho public URL).
  // Sau khi fetchMediaItems refetch, signed URL từ edge function sẽ thay thế.
  const publicUrl = URL.createObjectURL(file);
  let thumbnailUrl: string | undefined = publicUrl;

  // Generate + upload thumbnail for videos
  let thumbnailPath: string | undefined;

  if (type === 'video') {
    const thumbBlob = await generateVideoThumbnail(file);
    if (thumbBlob) {
      thumbnailPath = `${tripId}/${id}_thumb.jpg`;
      const { error: thumbErr } = await supabase.storage
        .from('trip-media').upload(thumbnailPath, thumbBlob, { upsert: false });
      if (!thumbErr) {
        thumbnailUrl = URL.createObjectURL(thumbBlob);
      } else {
        thumbnailPath = undefined; // ignore thumbnail error, keep video upload
      }
    }
  }

  const createdAt = new Date().toISOString();
  // Store the ORIGINAL file name + size (before compression) so that the
  // duplicate-detection fingerprint `${name}_${size}` is stable across uploads.
  const storedName = originalMeta?.name ?? file.name;
  const storedSize = originalMeta?.size ?? file.size;

  const item: MediaItem = {
    id, tripId, type,
    name: storedName, size: storedSize, caption: '',
    createdAt, takenAt,
    storagePath, thumbnailPath, publicUrl, thumbnailUrl,
  };

  try {
    await api.post('/media', {
      id: item.id, trip_id: item.tripId, type: item.type,
      name: item.name, size: item.size, caption: item.caption,
      storage_path: item.storagePath, created_at: item.createdAt,
      taken_at: item.takenAt ?? null,
      thumbnail_path: thumbnailPath ?? null,
    });
  } catch (dbError) {
    const toRemove = [storagePath, thumbnailPath].filter(Boolean) as string[];
    await supabase.storage.from('trip-media').remove(toRemove);
    throw dbError;
  }

  invalidateMediaCache(tripId);
  return item;
}

export async function updateMediaCaption(id: string, caption: string): Promise<void> {
  await api.put('/media', { caption }, { id });
}

export async function deleteMediaItem(item: MediaItem): Promise<void> {
  // Edge Function handles storage cleanup + DB delete atomically
  await api.delete('/media', { id: item.id });
  invalidateMediaCache(item.tripId);
}

// ── Invite / Members ──────────────────────────────────────────────────────────

function rowToMember(r: Record<string, unknown>): TripMember {
  const email = (r.user_email as string) ?? '';
  return {
    id: r.id as string,
    tripId: r.trip_id as string,
    userId: r.user_id as string,
    userEmail: email,
    displayName: (r.display_name as string) || email.split('@')[0],
    role: (r.role as 'owner' | 'member'),
    joinedAt: r.joined_at as string,
  };
}

function rowToInvite(r: Record<string, unknown>): TripInvite {
  return {
    id: r.id as string,
    tripId: r.trip_id as string,
    token: r.token as string,
    createdBy: r.created_by as string,
    tripName: (r.trip_name as string) ?? '',
    tripEmoji: (r.trip_emoji as string) ?? '✈️',
    ownerEmail: (r.owner_email as string) ?? '',
    status: r.status as 'active' | 'expired',
    expiresAt: r.expires_at as string,
    createdAt: r.created_at as string,
  };
}

export async function fetchTripMembers(tripId: string): Promise<TripMember[]> {
  return cachedFetch(`members_${tripId}`, async () => {
    const rows = await api.get<Record<string, unknown>[]>('/members', { tripId });
    return rows.map(r => rowToMember(r));
  });
}

export async function fetchMyProfile(): Promise<UserProfile | null> {
  const data = await api.get<Record<string, unknown> | null>('/profile');
  return data ? { userId: data.user_id as string, displayName: data.display_name as string } : null;
}

export async function upsertProfile(displayName: string): Promise<void> {
  await api.put('/profile', { displayName });
}

export async function createInvite(trip: Trip): Promise<string> {
  const { token } = await api.post<{ token: string }>(
    '/members',
    { tripId: trip.id, tripName: trip.name, tripEmoji: trip.emoji },
    { action: 'invite' },
  );
  return token;
}

export async function getInviteByToken(token: string): Promise<TripInvite | null> {
  const data = await api.get<Record<string, unknown> | null>('/members', {
    action: 'invite', token,
  });
  return data ? rowToInvite(data) : null;
}

export async function acceptInvite(token: string): Promise<string | null> {
  const { tripId } = await api.post<{ tripId: string }>(
    '/members',
    { token },
    { action: 'accept' },
  );
  return tripId ?? null;
}

export async function leaveTrip(tripId: string): Promise<void> {
  await api.delete('/members', { action: 'leave', tripId });
}

export async function removeMember(tripId: string, userId: string): Promise<void> {
  await api.delete('/members', { action: 'remove', tripId, memberId: userId });
}

export async function isOwner(tripId: string): Promise<boolean> {
  const { isOwner: result } = await api.get<{ isOwner: boolean }>('/members', {
    action: 'is-owner', tripId,
  });
  return result;
}

// ── Trip Expenses ─────────────────────────────────────────────────────────────

function rowToExpense(r: Record<string, unknown>): TripExpense {
  return {
    id:           r.id as string,
    tripId:       r.trip_id as string,
    description:  r.description as string,
    amount:       Number(r.amount),
    paidBy:       r.paid_by as string,
    paidByEmail:  r.paid_by_email as string,
    splits:       (r.splits as TripExpense['splits']) ?? [],
    date:         (r.date as string) ?? '',
    createdAt:    r.created_at as string,
    fundId:       (r.fund_id as string) ?? null,
  };
}

export async function fetchExpenses(tripId: string): Promise<TripExpense[]> {
  return cachedFetch(`expenses_${tripId}`, async () => {
    const rows = await api.get<Record<string, unknown>[]>('/expenses', { tripId });
    return rows.map(rowToExpense);
  });
}

export async function createExpense(expense: TripExpense): Promise<void> {
  await api.post('/expenses', {
    id:            expense.id,
    trip_id:       expense.tripId,
    description:   expense.description,
    amount:        expense.amount,
    paid_by:       expense.paidBy,
    paid_by_email: expense.paidByEmail,
    splits:        expense.splits,
    date:          expense.date || null,
    fund_id:       expense.fundId ?? null,
  });
}

export async function updateExpense(expense: TripExpense): Promise<void> {
  await api.put('/expenses', {
    description:   expense.description,
    amount:        expense.amount,
    paid_by:       expense.paidBy,
    paid_by_email: expense.paidByEmail,
    splits:        expense.splits,
    date:          expense.date || null,
    fund_id:       expense.fundId ?? null,
  }, { id: expense.id });
}

export async function deleteExpense(expenseId: string): Promise<void> {
  await api.delete('/expenses', { id: expenseId });
}

// ── Trip Funds ────────────────────────────────────────────────────────────────

function rowToFund(r: Record<string, unknown>): TripFund {
  return {
    id:              r.id as string,
    tripId:          r.trip_id as string,
    description:     r.description as string,
    amountPerPerson: Number(r.amount_per_person),
    createdBy:       r.created_by as string,
    createdAt:       r.created_at as string,
  };
}

function rowToFundPayment(r: Record<string, unknown>): TripFundPayment {
  return {
    id:        r.id as string,
    fundId:    r.fund_id as string,
    tripId:    r.trip_id as string,
    userId:    r.user_id as string,
    userEmail: r.user_email as string,
    paid:      r.paid as boolean,
    paidAt:    (r.paid_at as string) ?? null,
  };
}

export async function fetchFunds(tripId: string): Promise<TripFund[]> {
  return cachedFetch(`funds_${tripId}`, async () => {
    const rows = await api.get<Record<string, unknown>[]>('/funds', { tripId });
    return rows.map(rowToFund);
  });
}

export async function createFund(fund: TripFund, payments: TripFundPayment[]): Promise<void> {
  await api.post('/funds', {
    fund: {
      id:                fund.id,
      trip_id:           fund.tripId,
      description:       fund.description,
      amount_per_person: fund.amountPerPerson,
      created_by:        fund.createdBy,
      created_at:        fund.createdAt,
    },
    payments: payments.map(p => ({
      id:         p.id,
      fund_id:    p.fundId,
      trip_id:    p.tripId,
      user_id:    p.userId,
      user_email: p.userEmail,
      paid:       p.paid,
      paid_at:    p.paidAt,
    })),
  });
}

export async function deleteFund(fundId: string): Promise<void> {
  await api.delete('/funds', { id: fundId });
}

export async function fetchFundPayments(tripId: string): Promise<TripFundPayment[]> {
  return cachedFetch(`fundpayments_${tripId}`, async () => {
    const rows = await api.get<Record<string, unknown>[]>('/funds', {
      tripId, resource: 'payments',
    });
    return rows.map(rowToFundPayment);
  });
}

export async function toggleFundPayment(paymentId: string, paid: boolean): Promise<void> {
  await api.patch('/funds', { paid }, { id: paymentId });
}
