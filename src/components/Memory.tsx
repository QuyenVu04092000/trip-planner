import { useState, useRef, useEffect } from "react";
import {
  Upload, Trash2, X, Play, Image as ImageIcon, Film,
  Edit2, Check, CheckSquare, ChevronLeft, ChevronRight,
} from "lucide-react";
import type { MediaItem } from "../types";
import { uploadMedia, updateMediaCaption, deleteMediaItem, extractTakenAt } from "../utils/db";
import { formatSize, fmtDay, fmtDayShort } from "../utils/format";

interface Props {
  tripId: string;
  items: MediaItem[];
  onChange: (items: MediaItem[]) => void;
  startDate?: string;
  endDate?: string;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

// formatSize, fmtDay → imported from utils/format

function fmtCardDate(takenAt: string): string {
  const d = new Date(takenAt);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function fmtLightboxDate(takenAt: string): string {
  const d = new Date(takenAt);
  return d.toLocaleString('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function getTripDays(startDate?: string, endDate?: string): string[] {
  if (!startDate || !endDate) return [];
  const days: string[] = [];
  const [sy, sm, sd] = startDate.split('-').map(Number);
  const [ey, em, ed] = endDate.split('-').map(Number);
  const cur = new Date(sy, sm - 1, sd);
  const end = new Date(ey, em - 1, ed);
  while (cur <= end) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, '0');
    const d = String(cur.getDate()).padStart(2, '0');
    days.push(`${y}-${m}-${d}`);
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

const UPLOAD_CONCURRENCY = 3;
const COMPRESS_MAX_PX = 2000;
const VIDEO_SIZE_LIMIT = 50 * 1024 * 1024;

async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  return new Promise((resolve) => {
    const img = new globalThis.Image();
    const blobUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(blobUrl);
      if (img.width <= COMPRESS_MAX_PX && img.height <= COMPRESS_MAX_PX) { resolve(file); return; }
      const ratio = Math.min(COMPRESS_MAX_PX / img.width, COMPRESS_MAX_PX / img.height);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * ratio);
      canvas.height = Math.round(img.height * ratio);
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => resolve(blob ? new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }) : file),
        'image/jpeg', 0.85,
      );
    };
    img.onerror = () => { URL.revokeObjectURL(blobUrl); resolve(file); };
    img.src = blobUrl;
  });
}

// ── Media Card ────────────────────────────────────────────────────────────────

function MediaCard({
  item,
  onClick,
  onDelete,
  onCaptionSave,
  selectMode,
  selected,
  onToggleSelect,
}: {
  item: MediaItem;
  onClick: () => void;
  onDelete: () => void;
  onCaptionSave: (caption: string) => void;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  const [editingCaption, setEditingCaption] = useState(false);
  const [caption, setCaption] = useState(item.caption);

  const saveCaption = () => { onCaptionSave(caption); setEditingCaption(false); };

  return (
    <div
      className={`bg-white rounded-xl overflow-hidden shadow-sm border transition-all duration-200 fade-in cursor-pointer group ${
        selected
          ? 'border-terra ring-2 ring-terra/40 ring-offset-1'
          : 'border-sand hover:border-sand hover:shadow-md'
      }`}
      onClick={selectMode ? onToggleSelect : onClick}
    >
      {/* ── Thumbnail ── */}
      <div className="relative overflow-hidden bg-parchment" style={{ aspectRatio: '4/3' }}>
        {item.publicUrl ? (
          item.type === 'image' ? (
            <img
              src={item.thumbnailUrl ?? item.publicUrl}
              alt={item.caption || item.name}
              loading="lazy"
              decoding="async"
              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="w-full h-full bg-ink flex items-center justify-center relative overflow-hidden">
              {item.thumbnailUrl && item.thumbnailUrl !== item.publicUrl && (
                <>
                  <img
                    src={item.thumbnailUrl}
                    alt={item.caption || item.name}
                    className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                    loading="lazy"
                    decoding="async"
                  />
                  <div className="absolute inset-0 bg-black/30" />
                </>
              )}
              <div className="relative z-10 w-11 h-11 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center shadow-lg">
                <Play size={18} className="text-white ml-0.5" fill="white" />
              </div>
            </div>
          )
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            {item.type === 'image'
              ? <ImageIcon size={28} className="text-dune" />
              : <Film size={28} className="text-dune" />}
          </div>
        )}

        {/* Date badge */}
        {item.takenAt && !selectMode && (
          <div className="absolute top-2 right-2 bg-black/50 backdrop-blur-sm rounded-md px-1.5 py-0.5 text-white/90 text-[10px] font-semibold tracking-wide">
            {fmtCardDate(item.takenAt)}
          </div>
        )}

        {/* Video badge */}
        {item.type === 'video' && !selectMode && (
          <div className="absolute top-2 left-2 bg-black/50 backdrop-blur-sm rounded-md px-1.5 py-0.5 flex items-center gap-1">
            <Film size={9} className="text-white/80" />
            <span className="text-white/80 text-[10px] font-semibold">VIDEO</span>
          </div>
        )}

        {/* Select checkbox */}
        {selectMode && (
          <div className="absolute top-2 left-2 z-20">
            <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shadow-md transition-all ${
              selected ? 'bg-terra border-terra' : 'bg-white/80 border-white/60 backdrop-blur-sm'
            }`}>
              {selected && <Check size={13} className="text-white" strokeWidth={3} />}
            </div>
          </div>
        )}

        {/* Select dim overlay */}
        {selectMode && selected && (
          <div className="absolute inset-0 bg-terra/15 z-10" />
        )}
      </div>

      {/* ── Caption row ── */}
      {!selectMode && (
        <div className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
          {editingCaption ? (
            <div className="flex gap-1.5 items-center">
              <input
                autoFocus
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveCaption();
                  if (e.key === 'Escape') { setCaption(item.caption); setEditingCaption(false); }
                }}
                className="flex-1 text-xs border-b border-terra focus:outline-none bg-transparent text-ink py-0.5"
                placeholder="Thêm chú thích..."
              />
              <button onClick={saveCaption} className="text-moss hover:text-sage-dark flex-shrink-0">
                <Check size={13} />
              </button>
              <button onClick={() => { setCaption(item.caption); setEditingCaption(false); }} className="text-stone hover:text-stone flex-shrink-0">
                <X size={13} />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1 justify-between">
              <p
                className="text-xs text-stone truncate flex-1 cursor-text"
                onClick={() => setEditingCaption(true)}
              >
                {item.caption || (
                  <span className="text-dune italic">Thêm chú thích...</span>
                )}
              </p>
              {/* Always-visible action buttons */}
              <div className="flex items-center gap-0.5 flex-shrink-0">
                <button
                  onClick={() => setEditingCaption(true)}
                  className="w-6 h-6 rounded-md flex items-center justify-center text-dune hover:text-terra hover:bg-terra-pale transition-colors"
                  title="Sửa chú thích"
                >
                  <Edit2 size={11} />
                </button>
                <button
                  onClick={onDelete}
                  className="w-6 h-6 rounded-md flex items-center justify-center text-dune hover:text-wine hover:bg-wine-pale transition-colors"
                  title="Xóa"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Lightbox ──────────────────────────────────────────────────────────────────

function Lightbox({
  items,
  index,
  onClose,
  onNavigate,
}: {
  items: MediaItem[];
  index: number;
  onClose: () => void;
  onNavigate: (i: number) => void;
}) {
  const item = items[index];
  const hasPrev = index > 0;
  const hasNext = index < items.length - 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && hasPrev) onNavigate(index - 1);
      if (e.key === 'ArrowRight' && hasNext) onNavigate(index + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, hasPrev, hasNext, onClose, onNavigate]);

  if (!item) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col select-none">

      {/* ── Top bar ── */}
      <div className="absolute top-0 inset-x-0 z-10 flex items-start justify-between px-4 pt-safe-4 pb-16 bg-gradient-to-b from-black/70 to-transparent pointer-events-none">
        {/* Counter */}
        <div className="pointer-events-auto bg-black/40 backdrop-blur-sm rounded-lg px-2.5 py-1.5 text-white/70 text-xs font-semibold">
          {index + 1} / {items.length}
        </div>

        {/* Center: date + caption */}
        <div className="flex-1 text-center px-4 min-w-0">
          {item.takenAt && (
            <p className="text-white/70 text-xs font-medium">{fmtLightboxDate(item.takenAt)}</p>
          )}
          {item.caption && (
            <p className="text-white/50 text-xs mt-0.5 truncate">{item.caption}</p>
          )}
        </div>

        {/* Close */}
        <button
          onClick={onClose}
          className="pointer-events-auto w-9 h-9 rounded-xl bg-black/40 backdrop-blur-sm hover:bg-white/20 flex items-center justify-center text-white transition-colors flex-shrink-0"
        >
          <X size={17} />
        </button>
      </div>

      {/* ── Main media ── */}
      <div className="flex-1 flex items-center min-h-0 relative" onClick={onClose}>
        {/* Prev */}
        {hasPrev && (
          <button
            onClick={(e) => { e.stopPropagation(); onNavigate(index - 1); }}
            className="absolute left-3 z-10 w-11 h-11 rounded-xl bg-black/40 backdrop-blur-sm hover:bg-white/20 flex items-center justify-center text-white transition-colors"
          >
            <ChevronLeft size={22} />
          </button>
        )}

        <div
          className="flex-1 h-full flex items-center justify-center px-16 py-20"
          onClick={(e) => e.stopPropagation()}
        >
          {item.type === 'image' ? (
            <img
              key={item.id}
              src={item.publicUrl ?? ''}
              alt={item.caption || item.name}
              className="max-h-full max-w-full rounded-xl object-contain shadow-2xl"
              decoding="async"
            />
          ) : (
            <video
              key={item.id}
              src={item.publicUrl ?? ''}
              controls
              autoPlay
              className="max-h-full max-w-full rounded-xl shadow-2xl"
            />
          )}
        </div>

        {/* Next */}
        {hasNext && (
          <button
            onClick={(e) => { e.stopPropagation(); onNavigate(index + 1); }}
            className="absolute right-3 z-10 w-11 h-11 rounded-xl bg-black/40 backdrop-blur-sm hover:bg-white/20 flex items-center justify-center text-white transition-colors"
          >
            <ChevronRight size={22} />
          </button>
        )}
      </div>

      {/* ── Thumbnail strip ── */}
      {items.length > 1 && (
        <div
          className="flex-shrink-0 bg-gradient-to-t from-black/80 to-transparent pt-6 pb-safe-5 px-4"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-center gap-1.5 overflow-x-auto scrollbar-none">
            {items.map((it, i) => (
              <button
                key={it.id}
                onClick={() => onNavigate(i)}
                className={`flex-shrink-0 rounded-lg overflow-hidden border-2 transition-all duration-200 ${
                  i === index
                    ? 'w-14 h-14 border-white shadow-lg'
                    : 'w-10 h-10 border-transparent opacity-40 hover:opacity-70'
                }`}
              >
                {it.thumbnailUrl ?? it.publicUrl ? (
                  <img
                    src={it.thumbnailUrl ?? it.publicUrl ?? ''}
                    alt=""
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full h-full bg-ink-light flex items-center justify-center">
                    <Film size={12} className="text-stone" />
                  </div>
                )}
              </button>
            ))}
          </div>

          {/* File info */}
          <p className="text-center text-white/25 text-[11px] mt-3">
            {item.name} · {formatSize(item.size)}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function Memory({ tripId, items, onChange, startDate, endDate }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [filter, setFilter] = useState<'all' | 'image' | 'video'>('all');
  const [dateFilter, setDateFilter] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number; phase: 'compressing' | 'uploading' } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [sizeWarning, setSizeWarning] = useState<string | null>(null);
  const [dupWarning, setDupWarning] = useState<string | null>(null);

  const tripDays = getTripDays(startDate, endDate);
  const untaggedCount = items.filter((i) => !i.takenAt).length;
  const imageCount = items.filter((i) => i.type === 'image').length;
  const videoCount = items.filter((i) => i.type === 'video').length;

  const byType = filter === 'all' ? items : items.filter((i) => i.type === filter);
  const filtered = dateFilter === 'untagged'
    ? byType.filter((i) => !i.takenAt)
    : dateFilter
      ? byType.filter((i) => i.takenAt?.startsWith(dateFilter))
      : byType;

  const selectedCount = selectedIds.size;
  const allFilteredSelected = filtered.length > 0 && filtered.every((i) => selectedIds.has(i.id));

  const exitSelectMode = () => { setSelectMode(false); setSelectedIds(new Set()); };
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    setSelectedIds(allFilteredSelected ? new Set() : new Set(filtered.map((i) => i.id)));
  };

  const handleDeleteSelected = async () => {
    if (selectedCount === 0) return;
    setDeleting(true);
    await Promise.all(items.filter((i) => selectedIds.has(i.id)).map((item) => deleteMediaItem(item).catch(console.error)));
    onChange(items.filter((i) => !selectedIds.has(i.id)));
    exitSelectMode();
    setDeleting(false);
  };

  const handleFiles = async (files: FileList) => {
    const all = Array.from(files).filter((f) => f.type.startsWith('image/') || f.type.startsWith('video/'));
    if (all.length === 0) return;

    // ── Phase 1: extract takenAt for ALL files before dedup ──────────────────
    // Must run first because iCloud rewrites the moov atom on each download,
    // changing file size by a few bytes (164 bytes in practice). So name+size
    // is not a stable fingerprint for iCloud videos. The embedded recording
    // timestamp (takenAt) IS stable → use name+takenAt as the primary key.
    const fileInfos = await Promise.all(
      all.map(async (f) => ({ file: f, takenAt: await extractTakenAt(f) }))
    );

    // ── Duplicate detection ──────────────────────────────────────────────────
    // Check BOTH fingerprints in OR:
    //   • name_size   — instant, covers identical byte-for-byte files
    //   • name_takenAt — covers iCloud re-downloads with different moov padding
    const existingBySize = new Set(items.map((i) => `${i.name}_${i.size}`));
    const existingByDate = new Set(
      items.filter((i) => i.takenAt).map((i) => `${i.name}_${i.takenAt}`)
    );
    const batchPrints = new Set<string>();
    const duplicates: string[] = [];
    const dedupedInfos: Array<{ file: File; takenAt: string | undefined }> = [];

    for (const { file: f, takenAt } of fileInfos) {
      const sizeKey  = `${f.name}_${f.size}`;
      const dateKey  = takenAt ? `${f.name}_${takenAt}` : null;
      const batchKey = `${f.name}_${f.size}_${f.lastModified}`;

      if (
        existingBySize.has(sizeKey) ||
        (dateKey !== null && existingByDate.has(dateKey)) ||
        batchPrints.has(batchKey)
      ) {
        duplicates.push(f.name);
      } else {
        dedupedInfos.push({ file: f, takenAt });
        batchPrints.add(batchKey);
      }
    }

    if (duplicates.length > 0) {
      const label = duplicates.length === 1
        ? `"${duplicates[0]}" đã tồn tại trong chuyến đi này.`
        : `${duplicates.length} file đã tồn tại: ${duplicates.join(', ')}.`;
      setDupWarning(label);
      setTimeout(() => setDupWarning(null), 5000);
    }
    if (dedupedInfos.length === 0) return;

    // ── Size check (videos only) ─────────────────────────────────────────────
    const oversized = dedupedInfos.filter(({ file: f }) => f.type.startsWith('video/') && f.size > VIDEO_SIZE_LIMIT);
    const validInfos = dedupedInfos.filter(({ file: f }) => !(f.type.startsWith('video/') && f.size > VIDEO_SIZE_LIMIT));
    if (oversized.length > 0) {
      const names = oversized.map(({ file: f }) => `${f.name} (${(f.size / 1024 / 1024).toFixed(0)}MB)`).join(', ');
      setSizeWarning(`Video quá lớn (giới hạn 50MB): ${names}. Vui lòng trim video trước khi upload.`);
      setTimeout(() => setSizeWarning(null), 6000);
    }
    if (validInfos.length === 0) return;

    setUploadProgress({ current: 0, total: validInfos.length, phase: 'compressing' });
    // takenAt already extracted above — reuse it, no need to call extractTakenAt again
    const prepared = await Promise.all(
      validInfos.map(async ({ file, takenAt }) => ({
        compressed: await compressImage(file),
        takenAt,
        originalName: file.name,
        originalSize: file.size,
      }))
    );
    let done = 0;
    const newItems: MediaItem[] = [];
    setUploadProgress({ current: 0, total: validInfos.length, phase: 'uploading' });
    for (let i = 0; i < prepared.length; i += UPLOAD_CONCURRENCY) {
      const batch = prepared.slice(i, i + UPLOAD_CONCURRENCY);
      const results = await Promise.all(
        batch.map(async ({ compressed, takenAt, originalName, originalSize }) => {
          try { return await uploadMedia(tripId, compressed, takenAt, { name: originalName, size: originalSize }); }
          catch (err) { console.error('Upload failed:', err); return null; }
          finally { done++; setUploadProgress({ current: done, total: validInfos.length, phase: 'uploading' }); }
        }),
      );
      newItems.push(...results.filter((r): r is MediaItem => r !== null));
    }
    if (newItems.length > 0) onChange([...items, ...newItems]);
    setUploadProgress(null);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) handleFiles(e.target.files);
    e.target.value = '';
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  };
  const handleDelete = async (item: MediaItem) => {
    await deleteMediaItem(item);
    onChange(items.filter((i) => i.id !== item.id));
  };
  const handleCaptionSave = async (id: string, caption: string) => {
    await updateMediaCaption(id, caption);
    onChange(items.map((i) => (i.id === id ? { ...i, caption } : i)));
  };

  return (
    <div className="flex flex-col h-full relative">

      {/* ── Toolbar ── */}
      <div className="bg-white border-b border-sand sticky top-0 z-10">
        {selectMode ? (
          /* Select mode toolbar */
          <div className="px-4 py-3 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-ink">
                  {selectedCount > 0 ? `Đã chọn ${selectedCount}` : 'Chọn ảnh / video'}
                </p>
                <button
                  onClick={toggleSelectAll}
                  className="text-xs text-terra hover:text-terra-dark font-medium transition-colors"
                >
                  {allFilteredSelected ? 'Bỏ chọn tất cả' : `Chọn tất cả (${filtered.length})`}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleDeleteSelected}
                  disabled={selectedCount === 0 || deleting}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold bg-wine hover:bg-wine-dark disabled:opacity-40 text-white transition-colors"
                >
                  <Trash2 size={14} />
                  {deleting ? 'Xóa...' : `Xóa${selectedCount > 0 ? ` (${selectedCount})` : ''}`}
                </button>
                <button
                  onClick={exitSelectMode}
                  className="w-9 h-9 flex items-center justify-center rounded-xl border border-sand text-stone hover:bg-paper transition-colors"
                >
                  <X size={16} />
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* Normal toolbar */
          <div className="px-4 py-3 flex items-center justify-between gap-3">
            {/* Type filter */}
            <div className="flex items-center gap-0.5 bg-parchment rounded-lg p-1 flex-shrink-0">
              {(['all', 'image', 'video'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                    filter === f ? 'bg-white shadow-sm text-ink' : 'text-stone hover:text-ink'
                  }`}
                >
                  {f === 'all' ? `Tất cả · ${items.length}` : f === 'image' ? `Ảnh · ${imageCount}` : `Video · ${videoCount}`}
                </button>
              ))}
            </div>
            {/* Actions */}
            <div className="flex items-center gap-2">
              {items.length > 0 && (
                <button
                  onClick={() => setSelectMode(true)}
                  className="w-9 h-9 sm:w-auto sm:px-3 rounded-xl text-sm font-medium text-stone hover:bg-parchment border border-sand transition-colors flex items-center justify-center"
                >
                  <CheckSquare size={14} className="sm:mr-1.5" />
                  <span className="hidden sm:inline">Chọn</span>
                </button>
              )}
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={!!uploadProgress}
                className="w-9 h-9 sm:w-auto sm:px-4 flex items-center justify-center gap-2 bg-terra hover:bg-terra-dark disabled:opacity-60 text-white rounded-xl text-sm font-semibold transition-colors"
              >
                <Upload size={14} />
                <span className="hidden sm:inline">
                  {uploadProgress
                    ? uploadProgress.phase === 'compressing'
                      ? 'Nén...'
                      : `${uploadProgress.current}/${uploadProgress.total}`
                    : 'Tải lên'}
                </span>
              </button>
            </div>
          </div>
        )}

        {/* ── Date filter chips ── */}
        {tripDays.length > 0 && (
          <div className="flex items-center gap-1.5 px-4 pb-2.5 overflow-x-auto scrollbar-none">
            <button
              onClick={() => setDateFilter(null)}
              className={`flex-shrink-0 h-7 px-3 rounded-full text-xs font-semibold transition-all ${
                dateFilter === null
                  ? 'bg-terra text-white shadow-sm'
                  : 'bg-parchment text-stone hover:bg-sand'
              }`}
            >
              Tất cả
            </button>
            {tripDays.map((day, i) => {
              const count = items.filter((item) => item.takenAt?.startsWith(day)).length;
              const isActive = dateFilter === day;
              const isEmpty = count === 0;
              return (
                <button
                  key={day}
                  onClick={() => !isEmpty && setDateFilter(isActive ? null : day)}
                  className={`flex-shrink-0 h-7 flex items-center gap-1.5 px-3 rounded-full text-xs font-semibold transition-all ${
                    isActive
                      ? 'bg-terra text-white shadow-sm'
                      : isEmpty
                        ? 'bg-paper text-dune cursor-default border border-dashed border-sand'
                        : 'bg-parchment text-stone hover:bg-sand'
                  }`}
                >
                  <span>Ngày {i + 1}</span>
                  <span className={`text-[10px] ${isActive ? 'text-white/70' : 'text-stone'}`}>
                    {fmtDayShort(day)}
                  </span>
                  {count > 0 && (
                    <span className={`text-[10px] font-bold rounded-full px-1 ${
                      isActive ? 'bg-white/25 text-white' : 'bg-sand text-stone'
                    }`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
            {untaggedCount > 0 && (
              <button
                onClick={() => setDateFilter(dateFilter === 'untagged' ? null : 'untagged')}
                className={`flex-shrink-0 h-7 flex items-center gap-1.5 px-3 rounded-full text-xs font-semibold transition-all ${
                  dateFilter === 'untagged'
                    ? 'bg-ink-light text-white shadow-sm'
                    : 'bg-parchment text-stone hover:bg-sand'
                }`}
              >
                Chưa có ngày
                <span className={`text-[10px] font-bold rounded-full px-1 ${
                  dateFilter === 'untagged' ? 'bg-white/25 text-white' : 'bg-sand text-stone'
                }`}>
                  {untaggedCount}
                </span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Duplicate warning toast */}
      {dupWarning && (
        <div className="mx-4 mt-3 px-4 py-3 bg-gold-pale border border-gold/40 rounded-xl text-gold-dark text-sm flex items-start gap-2.5">
          <span className="text-base leading-none mt-0.5">🔁</span>
          <span>{dupWarning}</span>
        </div>
      )}

      {/* Size warning toast */}
      {sizeWarning && (
        <div className="mx-4 mt-3 px-4 py-3 bg-wine-pale border border-wine/25 rounded-xl text-wine-dark text-sm flex items-start gap-2.5">
          <span className="text-base leading-none mt-0.5">⚠️</span>
          <span>{sizeWarning}</span>
        </div>
      )}

      {/* Upload progress overlay */}
      {uploadProgress && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-white rounded-2xl px-8 py-6 shadow-2xl flex flex-col items-center gap-4 min-w-[220px]">
            <div className="text-3xl">{uploadProgress.phase === 'compressing' ? '🗜️' : '📤'}</div>
            <div className="text-center">
              <p className="font-semibold text-ink text-sm mb-1">
                {uploadProgress.phase === 'compressing' ? 'Đang nén ảnh...' : 'Đang tải lên...'}
              </p>
              <p className="text-stone text-xs">
                {uploadProgress.phase === 'uploading'
                  ? `${uploadProgress.current} / ${uploadProgress.total} tệp xong`
                  : `${uploadProgress.total} tệp`}
              </p>
            </div>
            <div className="w-full bg-parchment rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-terra h-1.5 rounded-full transition-all duration-300"
                style={{
                  width: uploadProgress.phase === 'compressing'
                    ? '100%'
                    : `${(uploadProgress.current / uploadProgress.total) * 100}%`,
                  opacity: uploadProgress.phase === 'compressing' ? 0.4 : 1,
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Content area ── */}
      <div
        className={`flex-1 overflow-auto p-4 transition-colors duration-200 ${dragOver ? 'bg-terra-pale' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        {filtered.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center h-full min-h-64">
            <div
              className={`w-full max-w-sm border-2 border-dashed rounded-2xl p-10 flex flex-col items-center gap-4 text-center cursor-pointer transition-all ${
                dragOver
                  ? 'border-terra bg-terra-pale'
                  : 'border-sand hover:border-terra/40 hover:bg-paper/80'
              }`}
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="w-16 h-16 bg-parchment rounded-2xl flex items-center justify-center">
                {filter === 'video'
                  ? <Film size={28} className="text-dune" />
                  : <ImageIcon size={28} className="text-dune" />}
              </div>
              <div>
                <p className="font-semibold text-stone mb-1 text-[15px]">
                  {items.length === 0 ? 'Thêm ảnh & video' : 'Không có kết quả'}
                </p>
                <p className="text-stone text-sm leading-relaxed">
                  {items.length === 0
                    ? 'Kéo thả hoặc nhấp để chọn tệp từ thiết bị'
                    : 'Thử chọn bộ lọc khác'}
                </p>
              </div>
              {items.length === 0 && (
                <p className="text-xs text-dune">JPG · PNG · MP4 · MOV</p>
              )}
            </div>
          </div>
        ) : (
          /* Grid */
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {filtered.map((item, idx) => (
              <MediaCard
                key={item.id}
                item={item}
                onClick={() => setLightboxIndex(idx)}
                onDelete={() => handleDelete(item)}
                onCaptionSave={(caption) => handleCaptionSave(item.id, caption)}
                selectMode={selectMode}
                selected={selectedIds.has(item.id)}
                onToggleSelect={() => toggleSelect(item.id)}
              />
            ))}

            {/* Add more card */}
            {!selectMode && (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-sand rounded-xl flex flex-col items-center justify-center gap-2 text-dune hover:text-terra hover:border-terra/40 hover:bg-terra-pale/50 cursor-pointer transition-all"
                style={{ aspectRatio: '4/3' }}
              >
                <Upload size={20} />
                <span className="text-xs font-semibold">Thêm</span>
              </div>
            )}
          </div>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,video/*"
        className="hidden"
        onChange={handleFileInput}
      />

      {/* Lightbox */}
      {lightboxIndex !== null && !selectMode && (
        <Lightbox
          items={filtered}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
        />
      )}
    </div>
  );
}
