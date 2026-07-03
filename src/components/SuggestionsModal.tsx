import { useState, useEffect, useCallback } from "react";
import {
  X, Sparkles, RefreshCw, MapPin, Plus, Check,
  Utensils, Coffee, Landmark, Camera,
} from "lucide-react";
import type { Suggestion, SuggestionCategory } from "../types";
import { fetchSuggestions } from "../utils/db";
import { openPlace } from "../utils/maps";

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string;

// Ảnh-bản-đồ tĩnh (fallback khi không có ảnh thật) — có pin tại vị trí
function staticMapUrl(s: Suggestion): string | null {
  if (s.lat == null || s.lon == null) return null;
  return (
    `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/` +
    `pin-s+7c3aed(${s.lon},${s.lat})/${s.lon},${s.lat},13/600x240@2x` +
    `?access_token=${MAPBOX_TOKEN}`
  );
}

interface Props {
  tripId: string;
  destination: string;
  onAdd: (s: Suggestion) => Promise<void>;
  onClose: () => void;
}

const CAT: Record<SuggestionCategory, { label: string; Icon: typeof Coffee; cls: string }> = {
  food:       { label: "Quán ăn",   Icon: Utensils, cls: "bg-orange-100 text-orange-700" },
  cafe:       { label: "Cà phê",    Icon: Coffee,   cls: "bg-amber-100 text-amber-700" },
  attraction: { label: "Tham quan", Icon: Landmark, cls: "bg-blue-100 text-blue-700" },
  checkin:    { label: "Check-in",  Icon: Camera,   cls: "bg-pink-100 text-pink-700" },
};


export default function SuggestionsModal({ tripId, destination, onAdd, onClose }: Props) {
  const [items, setItems] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchSuggestions(tripId, destination, refresh);
      setItems(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không tải được gợi ý");
    } finally {
      setLoading(false);
    }
  }, [tripId, destination]);

  useEffect(() => { void load(); }, [load]);

  const handleAdd = async (s: Suggestion) => {
    await onAdd(s);
    setAdded((prev) => new Set(prev).add(s.name));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl shadow-2xl max-h-[88vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-violet-500" />
            <div>
              <h2 className="font-bold text-slate-800 text-[15px] leading-tight">Gợi ý địa điểm</h2>
              <p className="text-xs text-slate-400 leading-tight">{destination}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => load(true)}
              disabled={loading}
              title="Tạo lại gợi ý"
              className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 disabled:opacity-40"
            >
              <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
            </button>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* List */}
        <div className="overflow-y-auto px-4 py-3 space-y-2.5">
          {loading && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
              <Sparkles size={28} className="animate-pulse text-violet-400" />
              <p className="text-sm">Đang tìm chỗ hay ở {destination}…</p>
            </div>
          )}

          {error && !loading && (
            <div className="text-center py-12">
              <p className="text-sm text-rose-500 mb-3">{error}</p>
              <button
                onClick={() => load(true)}
                className="text-sm font-semibold text-violet-600 hover:underline"
              >
                Thử lại
              </button>
            </div>
          )}

          {!loading && !error && items.length === 0 && (
            <p className="text-center text-sm text-slate-400 py-12">Chưa có gợi ý nào.</p>
          )}

          {!loading && items.map((s) => {
            const cat = CAT[s.category] ?? CAT.attraction;
            const isAdded = added.has(s.name);
            return (
              <div
                key={s.name}
                className="border border-slate-100 rounded-xl p-3.5 hover:border-slate-200 transition-colors"
              >
                {(s.photoUrl || staticMapUrl(s)) && (
                  <img
                    src={s.photoUrl ?? staticMapUrl(s) ?? ""}
                    alt={s.name}
                    loading="lazy"
                    className="w-full h-32 object-cover rounded-lg mb-2.5 bg-slate-100"
                  />
                )}
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <h3 className="font-semibold text-slate-800 text-sm leading-snug flex-1">{s.name}</h3>
                  <span className={`flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${cat.cls}`}>
                    <cat.Icon size={11} />
                    {cat.label}
                  </span>
                </div>
                <p className="text-[13px] text-slate-500 leading-relaxed mb-2">{s.description}</p>
                {s.address && (
                  <p className="flex items-start gap-1 text-xs text-slate-400 mb-3">
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
                        ? "bg-green-100 text-green-700 cursor-default"
                        : "bg-blue-600 text-white hover:bg-blue-700"
                    }`}
                  >
                    {isAdded ? <><Check size={13} /> Đã thêm</> : <><Plus size={13} /> Thêm vào lịch trình</>}
                  </button>
                  <button
                    onClick={() => openPlace(s)}
                    className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
                  >
                    <MapPin size={13} /> Bản đồ
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer note */}
        {!loading && items.length > 0 && (
          <div className="px-5 py-2.5 border-t border-slate-100">
            <p className="text-[11px] text-slate-400 text-center">
              Gợi ý bởi AI · có thể chưa chính xác 100%
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
