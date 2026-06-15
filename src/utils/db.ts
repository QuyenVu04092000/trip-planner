import { supabase } from './supabase';
import type { Trip, Activity, MediaItem, TripMember, TripInvite, TripExpense, TripFund, TripFundPayment } from '../types';
import exifr from 'exifr';


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
    start_date: t.startDate, end_date: t.endDate,
    cover_color: t.coverColor, emoji: t.emoji,
    created_at: t.createdAt, updated_at: t.updatedAt,
  };
}

function rowToMediaItem(r: Record<string, unknown>): MediaItem {
  const storagePath = (r.storage_path as string) ?? '';
  const thumbnailPath = (r.thumbnail_path as string) || undefined;
  const type = r.type as 'image' | 'video';
  const { publicUrl, thumbnailUrl: imgThumbUrl } = getUrls(storagePath, type);

  // Videos: use dedicated thumbnail image if available, otherwise fall back
  const thumbnailUrl = (type === 'video' && thumbnailPath)
    ? supabase.storage.from('trip-media').getPublicUrl(thumbnailPath).data.publicUrl
    : imgThumbUrl;

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
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  // 1. Own trips — explicit filter, không phụ thuộc RLS
  const { data: ownData, error: e1 } = await supabase
    .from('trips')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
  if (e1) throw e1;

  // 2. Shared trips — lấy trip_ids từ trip_members (role = 'member')
  const { data: memberRows, error: e2 } = await supabase
    .from('trip_members')
    .select('trip_id')
    .eq('user_id', user.id)
    .eq('role', 'member');
  if (e2) throw e2;

  const sharedIds = (memberRows ?? []).map((r: any) => r.trip_id as string);
  let sharedTrips: Trip[] = [];
  if (sharedIds.length > 0) {
    const { data: sharedData, error: e3 } = await supabase
      .from('trips')
      .select('*')
      .in('id', sharedIds);
    if (e3) throw e3;
    sharedTrips = (sharedData ?? []).map(rowToTrip);
  }

  // 3. Gộp + dedup + sort
  const own = (ownData ?? []).map(rowToTrip);
  const merged = [...own];
  for (const t of sharedTrips) {
    if (!merged.find(x => x.id === t.id)) merged.push(t);
  }
  merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return merged;
}

export async function createTrip(trip: Trip): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const { error } = await supabase.from('trips').insert({ ...tripToRow(trip), user_id: user.id });
  if (error) throw error;
  // Add owner to trip_members
  await supabase.from('trip_members').insert({
    id: `mem_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    trip_id: trip.id,
    user_id: user.id,
    user_email: user.email ?? '',
    role: 'owner',
  });
}

export async function updateTrip(trip: Trip): Promise<void> {
  // Also backfill user_id in case trip was created before the column existed
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase
    .from('trips')
    .update({ ...tripToRow(trip), ...(user?.id ? { user_id: user.id } : {}) })
    .eq('id', trip.id);
  if (error) throw error;
}

export async function deleteTrip(tripId: string): Promise<void> {
  const { data: mediaRows } = await supabase
    .from('media_items').select('storage_path, thumbnail_path').eq('trip_id', tripId);

  if (mediaRows?.length) {
    const paths: string[] = [];
    for (const r of mediaRows as { storage_path: string; thumbnail_path?: string }[]) {
      if (r.storage_path) paths.push(r.storage_path);
      if (r.thumbnail_path) paths.push(r.thumbnail_path);
    }
    if (paths.length) await supabase.storage.from('trip-media').remove(paths);
  }

  invalidateMediaCache(tripId);
  const { error } = await supabase.from('trips').delete().eq('id', tripId);
  if (error) throw error;
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
    cost: (r.cost as string) ?? '',
    notes: (r.notes as string) ?? '',
    position: (r.position as number) ?? 0,
    createdAt: r.created_at as string,
  };
}

export async function fetchActivities(tripId: string): Promise<Activity[]> {
  const { data, error } = await supabase
    .from('activities').select('*').eq('trip_id', tripId)
    .order('position').order('created_at');
  if (error) throw error;
  return (data ?? []).map(rowToActivity);
}

export async function createActivity(
  tripId: string,
  fields: Omit<Activity, 'id' | 'tripId' | 'createdAt'>,
): Promise<Activity> {
  const id = `act_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const row = {
    id, trip_id: tripId,
    date: fields.date, time: fields.time, activity: fields.activity,
    address: fields.address, cost: fields.cost, notes: fields.notes,
    position: fields.position,
  };
  const { data, error } = await supabase.from('activities').insert(row).select().single();
  if (error) throw error;
  return rowToActivity(data as Record<string, unknown>);
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
  if (fields.cost     !== undefined) row.cost     = fields.cost;
  if (fields.notes    !== undefined) row.notes    = fields.notes;
  if (fields.position !== undefined) row.position = fields.position;
  const { error } = await supabase.from('activities').update(row).eq('id', id);
  if (error) throw error;
}

export async function deleteActivity(id: string): Promise<void> {
  const { error } = await supabase.from('activities').delete().eq('id', id);
  if (error) throw error;
}

// ── Media ─────────────────────────────────────────────────────────────────────

export async function fetchMediaItems(tripId: string): Promise<MediaItem[]> {
  const cached = getCached(tripId);
  if (cached) return cached;

  const { data, error } = await supabase
    .from('media_items').select('*').eq('trip_id', tripId)
    .order('created_at', { ascending: true });
  if (error) throw error;

  const items = (data ?? []).map(rowToMediaItem);
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
  const { publicUrl, thumbnailUrl: imgThumbUrl } = getUrls(storagePath, type);

  // Generate + upload thumbnail for videos
  let thumbnailPath: string | undefined;
  let thumbnailUrl: string | undefined = imgThumbUrl;

  if (type === 'video') {
    const thumbBlob = await generateVideoThumbnail(file);
    if (thumbBlob) {
      thumbnailPath = `${tripId}/${id}_thumb.jpg`;
      const { error: thumbErr } = await supabase.storage
        .from('trip-media').upload(thumbnailPath, thumbBlob, { upsert: false });
      if (!thumbErr) {
        thumbnailUrl = supabase.storage.from('trip-media').getPublicUrl(thumbnailPath).data.publicUrl;
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

  const { error: dbError } = await supabase.from('media_items').insert({
    id: item.id, trip_id: item.tripId, type: item.type,
    name: item.name, size: item.size, caption: item.caption,
    storage_path: item.storagePath, created_at: item.createdAt,
    taken_at: item.takenAt ?? null,
    thumbnail_path: thumbnailPath ?? null,
  });

  if (dbError) {
    const toRemove = [storagePath, thumbnailPath].filter(Boolean) as string[];
    await supabase.storage.from('trip-media').remove(toRemove);
    throw dbError;
  }

  invalidateMediaCache(tripId);
  return item;
}

export async function updateMediaCaption(id: string, caption: string): Promise<void> {
  const { error } = await supabase.from('media_items').update({ caption }).eq('id', id);
  if (error) throw error;
}

export async function deleteMediaItem(item: MediaItem): Promise<void> {
  const toRemove = [item.storagePath, item.thumbnailPath].filter(Boolean) as string[];
  if (toRemove.length) await supabase.storage.from('trip-media').remove(toRemove);
  const { error } = await supabase.from('media_items').delete().eq('id', item.id);
  if (error) throw error;
  invalidateMediaCache(item.tripId);
}

// ── Invite / Members ──────────────────────────────────────────────────────────

function rowToMember(r: Record<string, unknown>): TripMember {
  return {
    id: r.id as string,
    tripId: r.trip_id as string,
    userId: r.user_id as string,
    userEmail: (r.user_email as string) ?? '',
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
  const { data, error } = await supabase
    .from('trip_members').select('*').eq('trip_id', tripId)
    .order('joined_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(rowToMember);
}

export async function createInvite(trip: Trip): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const token = crypto.randomUUID();
  const id = `inv_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await supabase.from('trip_invites').insert({
    id,
    trip_id: trip.id,
    token,
    created_by: user.id,
    trip_name: trip.name,
    trip_emoji: trip.emoji,
    owner_email: user.email ?? '',
    status: 'active',
    expires_at: expiresAt,
  });
  if (error) throw error;
  return token;
}

export async function getInviteByToken(token: string): Promise<TripInvite | null> {
  const { data, error } = await supabase
    .from('trip_invites').select('*').eq('token', token).single();
  if (error || !data) return null;
  return rowToInvite(data as Record<string, unknown>);
}

export async function acceptInvite(token: string): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const invite = await getInviteByToken(token);
  if (!invite || invite.status !== 'active') return null;
  if (new Date(invite.expiresAt) < new Date()) return null;

  // Insert member (ignore if already member)
  await supabase.from('trip_members').upsert({
    id: `mem_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    trip_id: invite.tripId,
    user_id: user.id,
    user_email: user.email ?? '',
    role: 'member',
  }, { onConflict: 'trip_id,user_id', ignoreDuplicates: true });

  return invite.tripId;
}

export async function leaveTrip(tripId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { error } = await supabase.from('trip_members')
    .delete().eq('trip_id', tripId).eq('user_id', user.id).eq('role', 'member');
  if (error) throw error;
}

export async function removeMember(tripId: string, userId: string): Promise<void> {
  const { error } = await supabase.from('trip_members')
    .delete().eq('trip_id', tripId).eq('user_id', userId).eq('role', 'member');
  if (error) throw error;
}

export async function isOwner(tripId: string): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase.from('trip_members')
    .select('role').eq('trip_id', tripId).eq('user_id', user.id).single();
  return (data as any)?.role === 'owner';
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
  };
}

export async function fetchExpenses(tripId: string): Promise<TripExpense[]> {
  const { data, error } = await supabase
    .from('trip_expenses')
    .select('*')
    .eq('trip_id', tripId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(rowToExpense);
}

export async function createExpense(expense: TripExpense): Promise<void> {
  const { error } = await supabase.from('trip_expenses').insert({
    id:            expense.id,
    trip_id:       expense.tripId,
    description:   expense.description,
    amount:        expense.amount,
    paid_by:       expense.paidBy,
    paid_by_email: expense.paidByEmail,
    splits:        expense.splits,
    date:          expense.date || null,
  });
  if (error) throw error;
}

export async function updateExpense(expense: TripExpense): Promise<void> {
  const { error } = await supabase.from('trip_expenses').update({
    description:   expense.description,
    amount:        expense.amount,
    paid_by:       expense.paidBy,
    paid_by_email: expense.paidByEmail,
    splits:        expense.splits,
    date:          expense.date || null,
  }).eq('id', expense.id);
  if (error) throw error;
}

export async function deleteExpense(expenseId: string): Promise<void> {
  const { error } = await supabase
    .from('trip_expenses')
    .delete()
    .eq('id', expenseId);
  if (error) throw error;
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
  const { data, error } = await supabase
    .from('trip_funds')
    .select('*')
    .eq('trip_id', tripId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(rowToFund);
}

export async function createFund(fund: TripFund, payments: TripFundPayment[]): Promise<void> {
  const { error: e1 } = await supabase.from('trip_funds').insert({
    id:                fund.id,
    trip_id:           fund.tripId,
    description:       fund.description,
    amount_per_person: fund.amountPerPerson,
    created_by:        fund.createdBy,
    created_at:        fund.createdAt,
  });
  if (e1) throw e1;

  if (payments.length > 0) {
    const { error: e2 } = await supabase.from('trip_fund_payments').insert(
      payments.map(p => ({
        id:         p.id,
        fund_id:    p.fundId,
        trip_id:    p.tripId,
        user_id:    p.userId,
        user_email: p.userEmail,
        paid:       p.paid,
        paid_at:    p.paidAt,
      }))
    );
    if (e2) throw e2;
  }
}

export async function deleteFund(fundId: string): Promise<void> {
  const { error } = await supabase.from('trip_funds').delete().eq('id', fundId);
  if (error) throw error;
}

export async function fetchFundPayments(tripId: string): Promise<TripFundPayment[]> {
  const { data, error } = await supabase
    .from('trip_fund_payments')
    .select('*')
    .eq('trip_id', tripId);
  if (error) throw error;
  return (data ?? []).map(rowToFundPayment);
}

export async function toggleFundPayment(paymentId: string, paid: boolean): Promise<void> {
  const { error } = await supabase
    .from('trip_fund_payments')
    .update({ paid, paid_at: paid ? new Date().toISOString() : null })
    .eq('id', paymentId);
  if (error) throw error;
}
