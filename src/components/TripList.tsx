import { useState, useEffect, useRef, useCallback } from "react";
import { Plus, MapPin, Calendar, Plane, Trash2, ImageIcon, LogOut, Bell, BellRing, BellOff, RefreshCw } from "lucide-react";
import type { Trip } from "../types";
import { fetchMediaItems } from "../utils/db";
import { formatDateRange, getDays, getCountdown } from "../utils/format";
import { subscribeToPush, unsubscribeFromPush, getPushSubscriptionState } from "../utils/pushClient";
import CreateTripModal from "./CreateTripModal";

interface Props {
  trips: Trip[];
  onSelectTrip: (tripId: string) => void;
  onCreateTrip: (data: Omit<Trip, "id" | "createdAt" | "updatedAt">) => void;
  onDeleteTrip: (tripId: string) => void;
  onLogout: () => void;
  onRefresh: () => Promise<void>;
}

// ── Trip Card Cover with image cycling ──────────────────────────────────────

interface CoverProps {
  trip: Trip;
  onDelete: (e: React.MouseEvent) => void;
}

function TripCardCover({ trip, onDelete }: CoverProps) {
  // Single state object → single render when data arrives, prevents React
  // DOM reconciliation errors from multiple sequential setState calls.
  const [media, setMedia] = useState<{ urls: string[]; imageCount: number; loaded: boolean }>(
    { urls: [], imageCount: 0, loaded: false }
  );
  const [currentIdx, setCurrentIdx] = useState(0);
  const mountedRef = useRef(true);

  const { urls, imageCount, loaded } = media;

  useEffect(() => {
    mountedRef.current = true;
    fetchMediaItems(trip.id).then((items) => {
      if (!mountedRef.current) return;
      const images = items.filter((m) => m.type === "image");
      // Include video thumbnails (thumbnailUrl is a JPEG when generated;
      // if thumbnailUrl === publicUrl no thumbnail was generated → skip)
      const withThumb = items.filter((m) =>
        m.type === "image"
          ? !!(m.thumbnailUrl ?? m.publicUrl)
          : !!(m.thumbnailUrl && m.thumbnailUrl !== m.publicUrl)
      );
      const shuffled = [...withThumb].sort(() => Math.random() - 0.5).slice(0, 5);
      const valid = shuffled.map((m) => m.thumbnailUrl ?? m.publicUrl).filter((u): u is string => !!u);
      // Single setState → single render, DOM structure changes once
      setMedia({ urls: valid, imageCount: images.length, loaded: true });
    }).catch(() => {
      if (mountedRef.current) setMedia((s) => ({ ...s, loaded: true }));
    });
    return () => { mountedRef.current = false; };
  }, [trip.id]);

  // Cycle every 3s when multiple images
  useEffect(() => {
    if (urls.length < 2) return;
    const id = setInterval(() => {
      setCurrentIdx((i) => (i + 1) % urls.length);
    }, 3000);
    return () => clearInterval(id);
  }, [urls.length]);

  const hasImages = urls.length > 0;
  const dateStr = formatDateRange(trip.startDate, trip.endDate);
  const daysStr = getDays(trip.startDate, trip.endDate);
  const countdown = getCountdown(trip.startDate, trip.endDate);

  return (
    <div className={`relative overflow-hidden bg-black ${hasImages ? 'aspect-[4/3]' : 'h-52'}`}>

      {/* ── Background layer ── */}
      {hasImages ? (
        /* Blurred + darkened version of current image fills gaps */
        urls.map((url, i) => (
          <img
            key={`bg-${url}`}
            src={url}
            alt=""
            loading="lazy" decoding="async" className={`absolute inset-0 w-full h-full object-cover scale-125 blur-2xl brightness-[0.45] transition-opacity duration-1000 ${
              i === currentIdx ? "opacity-100" : "opacity-0"
            }`}
          />
        ))
      ) : (
        <div className={`absolute inset-0 bg-gradient-to-br ${trip.coverColor}`} />
      )}

      {/* ── Main image layer — object-contain keeps full photo visible ── */}
      {hasImages && urls.map((url, i) => (
        <img
          key={`main-${url}`}
          src={url}
          alt=""
          loading="lazy" decoding="async" className={`absolute inset-0 w-full h-full object-contain transition-opacity duration-1000 ease-in-out ${
            i === currentIdx ? "opacity-100" : "opacity-0"
          }`}
        />
      ))}

      {/* ── No image: big centered emoji ── */}
      {!hasImages && loaded && (
        <div className="absolute inset-0 flex items-center justify-center pb-12">
          <span className="text-7xl drop-shadow-lg">{trip.emoji}</span>
        </div>
      )}

      {/* ── Bottom gradient for text readability ── */}
      <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/85 via-black/40 to-transparent pointer-events-none" />

      {/* ── Text overlay — bottom left ── */}
      <div className="absolute inset-x-0 bottom-0 px-4 pb-3.5 z-10">
        <div className="flex items-end justify-between gap-2">
          <div className="min-w-0 flex-1">
            {/* Name row */}
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xl leading-none flex-shrink-0">{trip.emoji}</span>
              <h3 className="font-bold text-white text-[15px] leading-tight truncate" style={{ textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>
                {trip.name}
              </h3>
            </div>
            {/* Meta row */}
            <div className="flex items-center gap-2.5 flex-wrap">
              {trip.destination && (
                <span className="flex items-center gap-1 text-white/80 text-xs truncate max-w-[140px]">
                  <MapPin size={10} className="flex-shrink-0 text-rose-300" />
                  {trip.destination}
                </span>
              )}
              {dateStr !== "Chưa có ngày" && (
                <span className="flex items-center gap-1 text-white/70 text-xs flex-shrink-0">
                  <Calendar size={10} />
                  {dateStr}
                </span>
              )}
            </div>
          </div>
          {/* Countdown / days badge */}
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            {countdown.type === 'today' && (
              <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-green-400/90 text-white shadow-sm animate-pulse">
                Hôm nay! 🎉
              </span>
            )}
            {countdown.type === 'ongoing' && (
              <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-green-500/80 text-white shadow-sm">
                Đang diễn ra
              </span>
            )}
            {countdown.type === 'upcoming' && (
              <span className={`text-xs font-bold px-2.5 py-1 rounded-full shadow-sm ${
                countdown.days <= 3
                  ? 'bg-amber-400/90 text-white'
                  : countdown.days <= 7
                    ? 'bg-orange-400/80 text-white'
                    : 'bg-white/20 text-white border border-white/20 backdrop-blur-sm'
              }`}>
                {countdown.label}
              </span>
            )}
            {(countdown.type === 'ended' || countdown.type === 'no-date') && daysStr && (
              <span className="text-xs font-bold text-white bg-white/20 backdrop-blur-sm px-2.5 py-1 rounded-full border border-white/20">
                {daysStr}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Top row: slide dots + photo count + delete ── */}
      <div className="absolute top-2.5 inset-x-3 z-20 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {urls.length > 1 && (
            <div className="flex gap-1">
              {urls.map((_, i) => (
                <div
                  key={i}
                  className={`rounded-full transition-all duration-500 bg-white shadow-sm ${
                    i === currentIdx ? "w-4 h-1.5" : "w-1.5 h-1.5 opacity-50"
                  }`}
                />
              ))}
            </div>
          )}
          {imageCount > 0 && (
            <div className="flex items-center gap-1 bg-black/30 backdrop-blur-sm text-white/90 text-xs px-2 py-0.5 rounded-full">
              <ImageIcon size={10} />
              <span className="font-medium">{imageCount}</span>
            </div>
          )}
        </div>
        <button
          onClick={onDelete}
          className="opacity-50 group-hover:opacity-100 transition-opacity w-7 h-7 bg-black/25 hover:bg-black/55 rounded-lg flex items-center justify-center text-white backdrop-blur-sm"
        >
          <Trash2 size={13} />
        </button>
      </div>

      {/* Shimmer while loading */}
      {!loaded && <div className="absolute inset-0 animate-pulse bg-white/5" />}
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

// ── Pull-to-refresh hook ────────────────────────────────────────────────────

const PULL_THRESHOLD = 72; // px to pull before triggering refresh

function usePullToRefresh(onRefresh: () => Promise<void>) {
  const [pullY, setPullY] = useState(0);       // current pull distance
  const [refreshing, setRefreshing] = useState(false);
  const startYRef = useRef(0);
  const pullingRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if ((scrollRef.current?.scrollTop ?? 0) > 0) return; // only when at top
    startYRef.current = e.touches[0].clientY;
    pullingRef.current = true;
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!pullingRef.current || refreshing) return;
    const delta = e.touches[0].clientY - startYRef.current;
    if (delta <= 0) { setPullY(0); return; }
    // Rubber-band: resistance increases as you pull further
    setPullY(Math.min(delta * 0.45, PULL_THRESHOLD + 20));
  }, [refreshing]);

  const onTouchEnd = useCallback(async () => {
    if (!pullingRef.current) return;
    pullingRef.current = false;
    if (pullY >= PULL_THRESHOLD) {
      setRefreshing(true);
      setPullY(0);
      await onRefresh();
      setRefreshing(false);
    } else {
      setPullY(0);
    }
  }, [pullY, onRefresh]);

  return { scrollRef, pullY, refreshing, onTouchStart, onTouchMove, onTouchEnd };
}

// ── Main component ──────────────────────────────────────────────────────────

export default function TripList({
  trips,
  onSelectTrip,
  onCreateTrip,
  onDeleteTrip,
  onLogout,
  onRefresh,
}: Props) {
  const [showCreate, setShowCreate] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pushState, setPushState] = useState<'loading' | 'subscribed' | 'not-subscribed' | 'unsupported'>('loading');
  const [notifToast, setNotifToast] = useState<string | null>(null);

  const { scrollRef, pullY, refreshing, onTouchStart, onTouchMove, onTouchEnd } =
    usePullToRefresh(onRefresh);

  // Check current push subscription state on mount
  useEffect(() => {
    getPushSubscriptionState().then(setPushState);
  }, []);

  const showToast = (msg: string, ms = 3500) => {
    setNotifToast(msg);
    setTimeout(() => setNotifToast(null), ms);
  };

  const handleBell = async () => {
    if (pushState === 'unsupported') {
      showToast('Trình duyệt của bạn không hỗ trợ push notification.');
      return;
    }
    if (pushState === 'subscribed') {
      // Toggle off
      await unsubscribeFromPush();
      setPushState('not-subscribed');
      showToast('Đã tắt thông báo.');
      return;
    }
    // Request permission + subscribe
    const permission = await Notification.requestPermission();
    if (permission === 'denied') {
      showToast('Thông báo đang bị chặn. Vui lòng bật trong cài đặt trình duyệt.', 4000);
      return;
    }
    const ok = await subscribeToPush();
    if (ok) {
      setPushState('subscribed');
      // Check if running in standalone mode (installed PWA) — background push works here
      const isStandalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window.navigator as any).standalone === true;
      if (isStandalone) {
        showToast('Đã bật thông báo! Sẽ nhắc 7, 3, 1 ngày trước chuyến đi — kể cả khi đóng app 🔔', 4500);
      } else {
        showToast('Đã bật thông báo! Để nhận khi đóng app, hãy mở app từ màn hình chính (Add to Home Screen) 📲', 5500);
      }
    } else {
      showToast('Không thể bật thông báo. Thử lại sau nhé.');
    }
  };

  const handleDelete = (e: React.MouseEvent, tripId: string) => {
    e.stopPropagation();
    setDeletingId(tripId);
  };

  const confirmDelete = () => {
    if (deletingId) {
      onDeleteTrip(deletingId);
      setDeletingId(null);
    }
  };

  const pullProgress = Math.min(pullY / PULL_THRESHOLD, 1);
  const iconRotation = pullProgress * 180;

  return (
    <div className="h-screen bg-slate-50 flex flex-col overflow-hidden">
      {/* Header */}
      <header className="bg-zinc-900 sticky top-0 z-30 border-b border-zinc-800 pt-safe flex-shrink-0">
        <div className="max-w-5xl mx-auto px-4 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-white/10 rounded-xl flex items-center justify-center ring-1 ring-white/10">
              <Plane size={17} className="text-white" />
            </div>
            <div>
              <h1 className="font-bold text-white text-[17px] leading-tight tracking-tight">
                TripMemo
              </h1>
              <p className="text-[11px] text-zinc-400 font-medium leading-none mt-0.5 hidden sm:block">
                Lên kế hoạch & lưu kỷ niệm
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center justify-center gap-2 bg-white text-zinc-900 hover:bg-zinc-100 w-9 h-9 sm:w-auto sm:h-auto sm:px-4 sm:py-2 rounded-xl text-sm font-semibold transition-all hover:-translate-y-0.5 active:translate-y-0 shadow-sm"
            >
              <Plus size={15} />
              <span className="hidden sm:inline">Chuyến đi mới</span>
            </button>
            <button
              onClick={handleBell}
              title={pushState === 'subscribed' ? 'Push bật — nhấn để tắt' : 'Bật push notification'}
              disabled={pushState === 'loading'}
              className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all border ${
                pushState === 'subscribed'
                  ? 'bg-amber-400/20 border-amber-400/40 text-amber-300 hover:bg-amber-400/30'
                  : pushState === 'unsupported'
                    ? 'bg-white/5 border-white/10 text-zinc-600 cursor-not-allowed'
                    : 'bg-white/10 hover:bg-white/20 text-zinc-400 hover:text-white border-white/10'
              }`}
            >
              {pushState === 'subscribed'
                ? <BellRing size={15} />
                : pushState === 'unsupported'
                  ? <BellOff size={15} />
                  : <Bell size={15} />}
            </button>
            <button
              onClick={onLogout}
              title="Đăng xuất"
              className="w-9 h-9 bg-white/10 hover:bg-white/20 text-zinc-400 hover:text-white border border-white/10 rounded-xl flex items-center justify-center transition-all"
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </header>

      {/* Scrollable area with pull-to-refresh */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {/* Pull indicator */}
        <div
          className="flex items-center justify-center overflow-hidden transition-all duration-200"
          style={{ height: refreshing ? 56 : pullY }}
        >
          <div
            className={`w-9 h-9 rounded-full flex items-center justify-center shadow-md ${
              pullProgress >= 1 || refreshing ? 'bg-blue-500 text-white' : 'bg-white text-slate-400'
            } transition-colors duration-150`}
            style={{ transform: `rotate(${refreshing ? 0 : iconRotation}deg)` }}
          >
            <RefreshCw
              size={16}
              className={refreshing ? 'animate-spin' : ''}
            />
          </div>
        </div>

      <main className="max-w-5xl mx-auto px-4 py-8 pb-safe">
        {trips.length === 0 ? (
          <div className="text-center py-20 fade-in">
            <div className="text-8xl mb-6">🗺️</div>
            <h2 className="text-2xl font-bold text-slate-700 mb-3">
              Chưa có chuyến đi nào
            </h2>
            <p className="text-slate-400 mb-8 max-w-sm mx-auto text-sm leading-relaxed">
              Bắt đầu lên kế hoạch cho chuyến đi tiếp theo của bạn và lưu giữ
              những kỷ niệm đáng nhớ!
            </p>
            <button
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-xl font-medium transition-colors"
            >
              <Plus size={18} />
              Tạo chuyến đi đầu tiên
            </button>
          </div>
        ) : (
          <>
            <div className="mb-6">
              <h2 className="text-xl font-bold text-slate-800">
                Chuyến đi của tôi
              </h2>
              <p className="text-sm text-slate-400 mt-1">
                {trips.length} chuyến đi
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {trips.map((trip) => (
                <div
                  key={trip.id}
                  onClick={() => onSelectTrip(trip.id)}
                  className="rounded-2xl overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300 cursor-pointer group fade-in hover:-translate-y-1.5"
                >
                  <TripCardCover
                    trip={trip}
                    onDelete={(e) => handleDelete(e, trip.id)}
                  />
                </div>
              ))}

              {/* Add new card */}
              <button
                onClick={() => setShowCreate(true)}
                className="border-2 border-dashed border-slate-200 rounded-2xl min-h-[200px] flex flex-col items-center justify-center gap-2 text-slate-400 hover:text-blue-500 hover:border-blue-300 hover:bg-blue-50/50 transition-all"
              >
                <Plus size={28} />
                <span className="text-sm font-medium">Thêm chuyến đi</span>
              </button>
            </div>
          </>
        )}
      </main>
      </div> {/* end scrollable */}

      {showCreate && (
        <CreateTripModal
          onClose={() => setShowCreate(false)}
          onSave={(data) => {
            onCreateTrip(data);
            setShowCreate(false);
          }}
        />
      )}

      {/* Notification toast */}
      {notifToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-zinc-800 text-white text-sm px-4 py-3 rounded-2xl shadow-xl fade-in max-w-xs text-center">
          {notifToast}
        </div>
      )}

      {/* Delete confirm */}
      {deletingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm fade-in shadow-2xl">
            <div className="text-3xl mb-3">🗑️</div>
            <h3 className="font-bold text-slate-800 text-lg mb-2">
              Xóa chuyến đi?
            </h3>
            <p className="text-slate-500 text-sm mb-5">
              Toàn bộ kế hoạch và ảnh/video của chuyến đi này sẽ bị xóa vĩnh
              viễn.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeletingId(null)}
                className="flex-1 border border-slate-200 rounded-xl py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                Hủy
              </button>
              <button
                onClick={confirmDelete}
                className="flex-1 bg-rose-500 hover:bg-rose-600 text-white rounded-xl py-2.5 text-sm font-medium"
              >
                Xóa
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
