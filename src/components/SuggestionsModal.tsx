import { useState, useEffect, useCallback, useRef } from "react";
import {
  X, Sparkles, RefreshCw, MapPin, Plus, Check, Clock, Timer,
  Utensils, Coffee, Landmark, Camera,
} from "lucide-react";
import type { Suggestion, SuggestionCategory, SuggestionPrefs } from "../types";
import { fetchSuggestions } from "../utils/db";
import { openPlace } from "../utils/maps";

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string;

// Ảnh-bản-đồ tĩnh (fallback khi không có ảnh thật) — có pin tại vị trí
function staticMapUrl(s: Suggestion): string | null {
  if (s.lat == null || s.lon == null) return null;
  return (
    `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/` +
    `pin-s+C4622D(${s.lon},${s.lat})/${s.lon},${s.lat},13/600x240@2x` +
    `?access_token=${MAPBOX_TOKEN}`
  );
}

interface Props {
  tripId: string;
  destination: string;
  existingNames: string[]; // tên hoạt động đã có → không gợi ý lại
  onAdd: (s: Suggestion) => Promise<void>;
  onClose: () => void;
}

const CAT: Record<SuggestionCategory, { label: string; Icon: typeof Coffee; cls: string }> = {
  food:       { label: "Quán ăn",   Icon: Utensils, cls: "bg-terra-pale text-terra-dark" },
  cafe:       { label: "Cà phê",    Icon: Coffee,   cls: "bg-gold-pale text-gold-dark" },
  attraction: { label: "Tham quan", Icon: Landmark, cls: "bg-terra-pale text-terra-dark" },
  checkin:    { label: "Check-in",  Icon: Camera,   cls: "bg-clay-pale text-clay-dark" },
};

const COMPANION_OPTS = ["một mình", "cặp đôi", "gia đình", "nhóm bạn"];
const INTEREST_OPTS = ["ăn uống", "cà phê", "thiên nhiên", "sống ảo", "văn hoá"];

function normalizeName(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function prefsKey(tripId: string): string {
  return `tm_sugg_prefs_${tripId}`;
}
function loadPrefs(tripId: string): SuggestionPrefs {
  try {
    return JSON.parse(localStorage.getItem(prefsKey(tripId)) ?? "{}");
  } catch { return {}; }
}

export default function SuggestionsModal({ tripId, destination, existingNames, onAdd, onClose }: Props) {
  const [items, setItems] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [prefs, setPrefs] = useState<SuggestionPrefs>(() => loadPrefs(tripId));
  const [dirty, setDirty] = useState(false);
  const excludeRef = useRef(existingNames);
  excludeRef.current = existingNames;

  const load = useCallback(async (refresh = false, p?: SuggestionPrefs) => {
    setLoading(true);
    setError(null);
    setDirty(false);
    const use = p ?? loadPrefs(tripId);
    try {
      const data = await fetchSuggestions(tripId, destination, {
        refresh,
        companions: use.companions,
        interests: use.interests,
        exclude: excludeRef.current,
      });
      setItems(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được gợi ý");
    } finally {
      setLoading(false);
    }
  }, [tripId, destination]);

  useEffect(() => { void load(); }, [load]);

  const updatePrefs = (next: SuggestionPrefs) => {
    setPrefs(next);
    setDirty(true);
    try { localStorage.setItem(prefsKey(tripId), JSON.stringify(next)); } catch { /* quota */ }
  };

  const toggleInterest = (v: string) => {
    const cur = prefs.interests ?? [];
    updatePrefs({ ...prefs, interests: cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v] });
  };

  const handleAdd = async (s: Suggestion) => {
    await onAdd(s);
    setAdded((prev) => new Set(prev).add(s.name));
  };

  // Lọc trùng phía client (phòng cache cũ sinh trước khi thêm hoạt động)
  const existingSet = new Set(existingNames.map(normalizeName));
  const visible = items.filter((s) => !existingSet.has(normalizeName(s.name)));

  const chipCls = (active: boolean) =>
    `px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors ${
      active ? "bg-ink text-paper" : "bg-parchment text-stone hover:bg-sand"
    }`;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl shadow-2xl max-h-[88vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-sand">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-terra" />
            <div>
              <h2 className="font-bold text-ink text-[15px] leading-tight">Gợi ý địa điểm</h2>
              <p className="text-xs text-stone leading-tight">{destination}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => load(true)}
              disabled={loading}
              title="Tạo lại gợi ý"
              className="w-8 h-8 rounded-lg flex items-center justify-center text-stone hover:bg-parchment disabled:opacity-40"
            >
              <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
            </button>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-stone hover:bg-parchment"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Cá nhân hoá */}
        <div className="px-5 py-2.5 border-b border-sand/60 space-y-1.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] text-dune font-semibold w-14 flex-shrink-0">Đi với</span>
            {COMPANION_OPTS.map((c) => (
              <button
                key={c}
                onClick={() => updatePrefs({ ...prefs, companions: prefs.companions === c ? undefined : c })}
                className={chipCls(prefs.companions === c)}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] text-dune font-semibold w-14 flex-shrink-0">Thích</span>
            {INTEREST_OPTS.map((v) => (
              <button key={v} onClick={() => toggleInterest(v)} className={chipCls((prefs.interests ?? []).includes(v))}>
                {v}
              </button>
            ))}
            {dirty && !loading && (
              <button
                onClick={() => load(false, prefs)}
                className="ml-auto px-3 py-1 rounded-full text-[11px] font-semibold bg-terra text-white hover:bg-terra-dark"
              >
                Áp dụng
              </button>
            )}
          </div>
        </div>

        {/* List */}
        <div className="overflow-y-auto px-4 py-3 space-y-2.5">
          {loading && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-stone">
              <Sparkles size={28} className="animate-pulse text-terra" />
              <p className="text-sm">Đang tìm chỗ hay ở {destination}…</p>
            </div>
          )}

          {error && !loading && (
            <div className="text-center py-12">
              <p className="text-sm text-wine mb-3">{error}</p>
              <button
                onClick={() => load(true)}
                className="text-sm font-semibold text-terra-dark hover:underline"
              >
                Thử lại
              </button>
            </div>
          )}

          {!loading && !error && visible.length === 0 && (
            <p className="text-center text-sm text-stone py-12">Chưa có gợi ý nào.</p>
          )}

          {!loading && visible.map((s) => {
            const cat = CAT[s.category] ?? CAT.attraction;
            const isAdded = added.has(s.name);
            return (
              <div
                key={s.name}
                className="border border-sand rounded-xl p-3.5 hover:border-sand-dark transition-colors"
              >
                {(s.photoUrl || staticMapUrl(s)) && (
                  <img
                    src={s.photoUrl ?? staticMapUrl(s) ?? ""}
                    alt={s.name}
                    loading="lazy"
                    className="w-full h-32 object-cover rounded-lg mb-2.5 bg-parchment"
                  />
                )}
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <h3 className="font-semibold text-ink text-sm leading-snug flex-1">{s.name}</h3>
                  <span className={`flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${cat.cls}`}>
                    <cat.Icon size={11} />
                    {cat.label}
                  </span>
                </div>
                <p className="text-[13px] text-stone leading-relaxed mb-2">{s.description}</p>

                {/* Info chips: nên đi lúc nào · chơi bao lâu · tầm giá */}
                {(s.bestTime || s.duration || s.priceLevel) && (
                  <div className="flex items-center gap-1.5 flex-wrap mb-2">
                    {s.bestTime && (
                      <span className="flex items-center gap-1 text-[11px] font-medium text-stone bg-parchment px-2 py-0.5 rounded-full">
                        <Clock size={10} /> {s.bestTime}
                      </span>
                    )}
                    {s.duration && (
                      <span className="flex items-center gap-1 text-[11px] font-medium text-stone bg-parchment px-2 py-0.5 rounded-full">
                        <Timer size={10} /> {s.duration}
                      </span>
                    )}
                    {s.priceLevel && (
                      <span className="text-[11px] font-semibold text-gold-dark bg-gold-pale px-2 py-0.5 rounded-full">
                        {s.priceLevel}
                      </span>
                    )}
                  </div>
                )}

                {s.address && (
                  <p className="flex items-start gap-1 text-xs text-stone mb-3">
                    <MapPin size={12} className="flex-shrink-0 mt-0.5" />
                    <span className="line-clamp-1">{s.address}</span>
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleAdd(s)}
                    disabled={isAdded}
                    className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${
                      isAdded
                        ? "bg-sage-pale text-sage-dark cursor-default"
                        : "bg-terra text-white hover:bg-terra-dark"
                    }`}
                  >
                    {isAdded ? <><Check size={13} /> Đã thêm</> : <><Plus size={13} /> Thêm vào lịch trình</>}
                  </button>
                  <button
                    onClick={() => openPlace(s)}
                    className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg text-stone bg-parchment hover:bg-sand transition-colors"
                  >
                    <MapPin size={13} /> Bản đồ
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer note */}
        {!loading && visible.length > 0 && (
          <div className="px-5 py-2.5 border-t border-sand">
            <p className="text-[11px] text-stone text-center">
              Gợi ý bởi AI · có thể chưa chính xác 100%
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
