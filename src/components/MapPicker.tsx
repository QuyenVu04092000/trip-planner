import { useEffect, useRef, useState, useCallback } from "react";
import { X, MapPin, Check, Search, Loader2, ExternalLink } from "lucide-react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { suggestPlaces, getPlaceDetails, newSessionToken } from "../utils/places";
import { MAPBOX_TOKEN, forwardGeocode } from "../utils/mapbox";

// Bản đồ nền + thả ghim = Mapbox (không phụ thuộc billing Google).
// Ô tìm kiếm = Google Places (edge function `places`); nếu Google lỗi → tự chuyển
// sang Mapbox Search Box để không chết tìm kiếm.
mapboxgl.accessToken = MAPBOX_TOKEN;

interface Props {
  onSelect: (address: string, lat?: number, lon?: number) => void;
  onClose: () => void;
  initialValue?: string;
  // Toạ độ đã lưu của địa chỉ cũ → đặt ghim thẳng, khỏi geocode lại theo tên.
  initialCoords?: { lat: number; lon: number } | null;
}

interface Suggestion {
  id: string;
  mainText: string;
  secondaryText: string;
  source: "google" | "mapbox";
}

// Mapbox Search Box – suggest (dự phòng khi Google Places lỗi, toàn cầu)
async function mapboxSuggest(q: string, sessionToken: string): Promise<Suggestion[]> {
  const url = `https://api.mapbox.com/search/searchbox/v1/suggest?q=${encodeURIComponent(q)}&access_token=${MAPBOX_TOKEN}&session_token=${sessionToken}&language=vi&limit=6`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`mapbox suggest HTTP ${res.status}`);
  const data = await res.json();
  return (data.suggestions ?? []).map(
    (s: { mapbox_id: string; name: string; place_formatted?: string }) => ({
      id: s.mapbox_id,
      mainText: s.name,
      secondaryText: s.place_formatted ?? "",
      source: "mapbox" as const,
    }),
  );
}

// Mapbox Search Box – retrieve (lấy toạ độ khi chọn gợi ý Mapbox)
async function mapboxRetrieve(
  mapboxId: string,
  sessionToken: string,
): Promise<{ lat: number; lon: number; name: string } | null> {
  const url = `https://api.mapbox.com/search/searchbox/v1/retrieve/${mapboxId}?access_token=${MAPBOX_TOKEN}&session_token=${sessionToken}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const feature = data.features?.[0];
  if (!feature) return null;
  const p = feature.properties ?? {};
  const address: string | undefined = p.full_address ?? p.place_formatted;
  return {
    name: p.name && address && !address.startsWith(p.name) ? `${p.name}, ${address}` : address ?? p.name,
    lon: feature.geometry.coordinates[0],
    lat: feature.geometry.coordinates[1],
  };
}

// Mapbox Geocoding – reverse geocode khi click bản đồ
async function reverseGeocode(lat: number, lon: number): Promise<string> {
  const fallback = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lon},${lat}.json?access_token=${MAPBOX_TOKEN}&language=vi&limit=1`;
  const res = await fetch(url);
  if (!res.ok) return fallback;
  const data = await res.json();
  return data.features?.[0]?.place_name ?? fallback;
}

export default function MapPicker({ onSelect, onClose, initialValue = "", initialCoords }: Props) {
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const selectedRef = useRef<{ lat: number; lon: number } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Session token Google Places (autocomplete + 1 details = 1 session billing).
  // Tạo token mới sau mỗi lần chọn xong (kết thúc 1 session).
  // Dùng chung cho Mapbox Search Box (cũng tính theo session).
  const sessionToken = useRef(newSessionToken());
  // Google lỗi 1 lần (billing tắt…) → các lần gõ sau đi thẳng Mapbox, đỡ chờ.
  const googleDownRef = useRef(false);

  const [query, setQuery] = useState(initialValue);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [noResults, setNoResults] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [searching, setSearching] = useState(false);
  const [retrieving, setRetrieving] = useState(false);
  const [selectedAddress, setSelectedAddress] = useState(initialValue);
  const [reversing, setReversing] = useState(false);

  // Init Mapbox GL map
  useEffect(() => {
    if (!mapDivRef.current || mapRef.current) return;

    const map = new mapboxgl.Map({
      container: mapDivRef.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: [106.0, 16.0],
      zoom: 5,
      language: "vi",
    });

    map.addControl(new mapboxgl.NavigationControl(), "top-left");

    // Có toạ độ đã lưu → ghim thẳng. Chỉ có chữ → geocode Mapbox (đúng với địa chỉ
    // đầy đủ; tên ngắn kiểu "Hồ Gươm" có thể lệch nên toạ độ lưu sẵn được ưu tiên).
    if (initialCoords) {
      placeMarker(map, initialCoords.lat, initialCoords.lon);
    } else if (initialValue) {
      forwardGeocode(initialValue)
        .then((pos) => {
          if (pos && mapRef.current === map) placeMarker(map, pos.lat, pos.lon);
        })
        .catch(() => {});
    }

    map.on("click", async (e) => {
      const { lat, lng } = e.lngLat;
      placeMarker(map, lat, lng);
      setShowDropdown(false);
      setReversing(true);
      try {
        setSelectedAddress(await reverseGeocode(lat, lng));
      } catch {
        setSelectedAddress(`${lat.toFixed(5)}, ${lng.toFixed(5)}`);
      } finally {
        setReversing(false);
      }
    });

    mapRef.current = map;

    return () => {
      map.remove();
      markerRef.current = null;
      mapRef.current = null;
    };
  }, []);

  function placeMarker(map: mapboxgl.Map, lat: number, lng: number) {
    selectedRef.current = { lat, lon: lng };
    markerRef.current?.remove();
    markerRef.current = new mapboxgl.Marker({ color: "#C4622D" })
      .setLngLat([lng, lat])
      .addTo(map);
    map.flyTo({
      center: [lng, lat],
      zoom: Math.max(map.getZoom(), 15),
      duration: 800,
    });
  }

  // Google Places trước; lỗi → Mapbox Search Box.
  async function fetchSuggestions(q: string): Promise<Suggestion[]> {
    if (!googleDownRef.current) {
      try {
        const items = await suggestPlaces(q, sessionToken.current);
        return items.map((s) => ({
          id: s.placeId,
          mainText: s.mainText,
          secondaryText: s.secondaryText,
          source: "google" as const,
        }));
      } catch (e) {
        console.warn("[places] Google suggest failed → dùng Mapbox:", e);
        googleDownRef.current = true;
      }
    }
    return mapboxSuggest(q, sessionToken.current);
  }

  const handleSearch = useCallback((value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value.trim() || value.length < 2) {
      setSuggestions([]);
      setShowDropdown(false);
      setNoResults(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await fetchSuggestions(value);
        setSuggestions(data);
        setShowDropdown(data.length > 0);
        setNoResults(data.length === 0);
      } catch (e) {
        // Cả 2 nguồn lỗi (mạng…) → không treo, hiện fallback "Tìm trên Google Maps".
        console.error("[places] suggest failed:", e);
        setSuggestions([]);
        setShowDropdown(false);
        setNoResults(true);
      } finally {
        setSearching(false);
      }
    }, 300);
  }, []);

  async function selectSuggestion(s: Suggestion) {
    setShowDropdown(false);
    setQuery([s.mainText, s.secondaryText].filter(Boolean).join(", "));
    setRetrieving(true);
    try {
      if (s.source === "google") {
        const detail = await getPlaceDetails(s.id, sessionToken.current);
        if (detail.lat != null && detail.lon != null && mapRef.current) {
          placeMarker(mapRef.current, detail.lat, detail.lon);
        }
        // Lưu "Tên, Địa chỉ" cho dễ đọc; toạ độ Google đã gắn vào selectedRef qua placeMarker.
        setSelectedAddress(
          detail.name && detail.address && !detail.address.startsWith(detail.name)
            ? `${detail.name}, ${detail.address}`
            : detail.address || detail.name,
        );
      } else {
        const detail = await mapboxRetrieve(s.id, sessionToken.current);
        if (detail && mapRef.current) {
          placeMarker(mapRef.current, detail.lat, detail.lon);
          setSelectedAddress(detail.name);
        }
      }
    } catch (e) {
      console.error("[places] details failed:", e);
    } finally {
      setRetrieving(false);
      // Kết thúc 1 session Places → token mới cho lần tìm sau.
      sessionToken.current = newSessionToken();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 pt-safe-4 pb-3 bg-white shadow-sm z-20">
        <button
          onClick={onClose}
          className="w-9 h-9 flex items-center justify-center rounded-xl text-stone hover:bg-parchment transition-colors flex-shrink-0"
        >
          <X size={18} />
        </button>
        <div className="relative flex-1">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-dune pointer-events-none"
          />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            onFocus={() => {
              if (suggestions.length > 0) setShowDropdown(true);
            }}
            placeholder="Tìm địa điểm..."
            autoComplete="off"
            className="w-full pl-8 pr-8 py-2.5 bg-parchment rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-terra/25 focus:bg-white border border-transparent focus:border-terra transition-all placeholder:text-stone"
          />
          {(searching || retrieving) && (
            <Loader2
              size={13}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-dune animate-spin"
            />
          )}
        </div>
      </div>

      {/* Dropdown */}
      {(showDropdown || noResults) && !searching && (
        <div
          className="absolute left-0 right-0 z-30 bg-white border-b border-sand shadow-lg max-h-64 overflow-y-auto"
          style={{ top: "4.5rem" }}
        >
          {suggestions.length > 0 ? (
            <>
              {/* Nguồn kết quả — cả danh sách luôn cùng 1 nguồn */}
              {suggestions[0].source === "mapbox" ? (
                <p className="px-4 py-1.5 text-[11px] bg-amber-50 text-amber-800 border-b border-sand/60">
                  Kết quả từ Mapbox · Google đang lỗi, có thể kém chính xác
                </p>
              ) : (
                <p className="px-4 py-1.5 text-[11px] text-stone bg-paper border-b border-sand/60">
                  Kết quả từ Google
                </p>
              )}
              {suggestions.map((s) => (
                <button
                  key={s.id}
                  onMouseDown={() => selectSuggestion(s)}
                  className="w-full flex items-start gap-2.5 px-4 py-3 hover:bg-paper transition-colors text-left border-b border-sand/40 last:border-0"
                >
                  <MapPin
                    size={13}
                    className="flex-shrink-0 text-dune mt-0.5"
                  />
                  <div>
                    <p className="text-sm text-ink leading-snug">
                      {s.mainText}
                    </p>
                    <p className="text-xs text-stone mt-0.5">
                      {s.secondaryText}
                    </p>
                  </div>
                </button>
              ))}
              <a
                href={`https://www.google.com/maps/search/${encodeURIComponent(query)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-4 py-2.5 text-sm text-terra font-medium border-t border-sand hover:bg-paper transition-colors"
              >
                <ExternalLink size={13} />
                Tìm thêm trên Google Maps
              </a>
            </>
          ) : (
            <div className="px-4 py-3">
              <p className="text-sm text-stone mb-2">
                Không tìm thấy kết quả.
              </p>
              <a
                href={`https://www.google.com/maps/search/${encodeURIComponent(query)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-terra font-medium"
              >
                <ExternalLink size={13} />
                Tìm trên Google Maps
              </a>
              <p className="text-xs text-stone mt-1">
                Xong rồi quay lại nhấn vào bản đồ để chọn vị trí.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Map */}
      <div ref={mapDivRef} className="flex-1 z-10" />

      {/* Footer */}
      <div className="px-4 py-3 pb-safe-5 bg-white border-t border-sand min-h-[72px] flex items-center z-20">
        {reversing || retrieving ? (
          <div className="w-full flex items-center justify-center gap-2 text-stone text-sm">
            <Loader2 size={14} className="animate-spin" /> Đang lấy địa chỉ...
          </div>
        ) : selectedAddress ? (
          <div className="flex items-center gap-3 w-full">
            <MapPin size={16} className="flex-shrink-0 text-terra" />
            <p className="flex-1 text-sm text-ink leading-snug line-clamp-2">
              {selectedAddress}
            </p>
            <button
              onClick={() => onSelect(selectedAddress, selectedRef.current?.lat, selectedRef.current?.lon)}
              className="flex items-center gap-1.5 bg-terra text-white text-sm font-semibold px-4 py-2.5 rounded-xl flex-shrink-0 active:bg-terra-dark transition-colors"
            >
              <Check size={15} />
              Chọn
            </button>
          </div>
        ) : (
          <p className="w-full text-center text-sm text-stone">
            Tìm kiếm hoặc nhấn vào bản đồ để chọn địa điểm
          </p>
        )}
      </div>
    </div>
  );
}
