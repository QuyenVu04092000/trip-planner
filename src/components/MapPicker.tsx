import { useEffect, useRef, useState, useCallback } from "react";
import { X, MapPin, Check, Search, Loader2, ExternalLink } from "lucide-react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string;
mapboxgl.accessToken = MAPBOX_TOKEN;

interface Props {
  onSelect: (address: string) => void;
  onClose: () => void;
  initialValue?: string;
}

interface Suggestion {
  mapbox_id: string;
  name: string;
  place_formatted: string;
  full_address?: string;
}

// Search Box API – suggest (gợi ý nhanh, có POI)
async function suggestPlaces(
  q: string,
  sessionToken: string,
): Promise<Suggestion[]> {
  const url = `https://api.mapbox.com/search/searchbox/v1/suggest?q=${encodeURIComponent(q)}&access_token=${MAPBOX_TOKEN}&session_token=${sessionToken}&language=vi&country=VN&limit=6`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  return data.suggestions ?? [];
}

// Search Box API – retrieve (lấy tọa độ khi user chọn)
async function retrievePlace(
  mapboxId: string,
  sessionToken: string,
): Promise<{ lat: number; lon: number; name: string } | null> {
  const url = `https://api.mapbox.com/search/searchbox/v1/retrieve/${mapboxId}?access_token=${MAPBOX_TOKEN}&session_token=${sessionToken}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const feature = data.features?.[0];
  if (!feature) return null;
  return {
    name: feature.properties.full_address ?? feature.properties.name,
    lon: feature.geometry.coordinates[0],
    lat: feature.geometry.coordinates[1],
  };
}

// Geocoding API – forward geocode địa chỉ ban đầu để lấy tọa độ
async function forwardGeocode(address: string): Promise<{ lat: number; lon: number } | null> {
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json?access_token=${MAPBOX_TOKEN}&language=vi&limit=1`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const f = data.features?.[0];
  if (!f) return null;
  return { lon: f.center[0], lat: f.center[1] };
}

// Geocoding API – reverse geocode khi click map
async function reverseGeocode(lat: number, lon: number): Promise<string> {
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lon},${lat}.json?access_token=${MAPBOX_TOKEN}&language=vi&limit=1`;
  const res = await fetch(url);
  if (!res.ok) return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  const data = await res.json();
  return (
    data.features?.[0]?.place_name ?? `${lat.toFixed(5)}, ${lon.toFixed(5)}`
  );
}

export default function MapPicker({ onSelect, onClose, initialValue = "" }: Props) {
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Session token: 1 UUID per lần mở MapPicker (Mapbox billing theo session)
  const sessionToken = useRef(crypto.randomUUID());

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

    // Nếu có địa chỉ cũ, geocode để đặt marker đúng vị trí
    if (initialValue) {
      forwardGeocode(initialValue).then((pos) => {
        if (pos) placeMarker(map, pos.lat, pos.lon);
      });
    }

    map.on("click", async (e) => {
      const { lat, lng } = e.lngLat;
      placeMarker(map, lat, lng);
      setShowDropdown(false);
      setReversing(true);
      const addr = await reverseGeocode(lat, lng);
      setSelectedAddress(addr);
      setReversing(false);
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  function placeMarker(map: mapboxgl.Map, lat: number, lng: number) {
    markerRef.current?.remove();
    markerRef.current = new mapboxgl.Marker({ color: "#3b82f6" })
      .setLngLat([lng, lat])
      .addTo(map);
    map.flyTo({
      center: [lng, lat],
      zoom: Math.max(map.getZoom(), 15),
      duration: 800,
    });
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
        const data = await suggestPlaces(value, sessionToken.current);
        setSuggestions(data);
        setShowDropdown(data.length > 0);
        setNoResults(data.length === 0);
      } finally {
        setSearching(false);
      }
    }, 300);
  }, []);

  async function selectSuggestion(s: Suggestion) {
    setShowDropdown(false);
    setQuery(s.full_address ?? `${s.name}, ${s.place_formatted}`);
    setRetrieving(true);
    try {
      const detail = await retrievePlace(s.mapbox_id, sessionToken.current);
      if (detail && mapRef.current) {
        placeMarker(mapRef.current, detail.lat, detail.lon);
        setSelectedAddress(detail.name);
      }
    } finally {
      setRetrieving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 pt-safe-4 pb-3 bg-white shadow-sm z-20">
        <button
          onClick={onClose}
          className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 transition-colors flex-shrink-0"
        >
          <X size={18} />
        </button>
        <div className="relative flex-1">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none"
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
            className="w-full pl-8 pr-8 py-2.5 bg-slate-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:bg-white border border-transparent focus:border-blue-400 transition-all placeholder:text-slate-400"
          />
          {(searching || retrieving) && (
            <Loader2
              size={13}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 animate-spin"
            />
          )}
        </div>
      </div>

      {/* Dropdown */}
      {(showDropdown || noResults) && !searching && (
        <div
          className="absolute left-0 right-0 z-30 bg-white border-b border-slate-100 shadow-lg max-h-64 overflow-y-auto"
          style={{ top: "4.5rem" }}
        >
          {suggestions.length > 0 ? (
            <>
              {suggestions.map((s) => (
                <button
                  key={s.mapbox_id}
                  onMouseDown={() => selectSuggestion(s)}
                  className="w-full flex items-start gap-2.5 px-4 py-3 hover:bg-slate-50 transition-colors text-left border-b border-slate-50 last:border-0"
                >
                  <MapPin
                    size={13}
                    className="flex-shrink-0 text-slate-300 mt-0.5"
                  />
                  <div>
                    <p className="text-sm text-slate-700 leading-snug">
                      {s.name}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {s.full_address}
                    </p>
                  </div>
                </button>
              ))}
              <a
                href={`https://www.google.com/maps/search/${encodeURIComponent(query)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-4 py-2.5 text-sm text-blue-500 font-medium border-t border-slate-100 hover:bg-slate-50 transition-colors"
              >
                <ExternalLink size={13} />
                Tìm thêm trên Google Maps
              </a>
            </>
          ) : (
            <div className="px-4 py-3">
              <p className="text-sm text-slate-400 mb-2">
                Không tìm thấy kết quả.
              </p>
              <a
                href={`https://www.google.com/maps/search/${encodeURIComponent(query)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-blue-500 font-medium"
              >
                <ExternalLink size={13} />
                Tìm trên Google Maps
              </a>
              <p className="text-xs text-slate-400 mt-1">
                Xong rồi quay lại nhấn vào bản đồ để chọn vị trí.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Map */}
      <div ref={mapDivRef} className="flex-1 z-10" />

      {/* Footer */}
      <div className="px-4 py-3 pb-safe-5 bg-white border-t border-slate-100 min-h-[72px] flex items-center z-20">
        {reversing || retrieving ? (
          <div className="w-full flex items-center justify-center gap-2 text-slate-400 text-sm">
            <Loader2 size={14} className="animate-spin" /> Đang lấy địa chỉ...
          </div>
        ) : selectedAddress ? (
          <div className="flex items-center gap-3 w-full">
            <MapPin size={16} className="flex-shrink-0 text-blue-500" />
            <p className="flex-1 text-sm text-slate-700 leading-snug line-clamp-2">
              {selectedAddress}
            </p>
            <button
              onClick={() => onSelect(selectedAddress)}
              className="flex items-center gap-1.5 bg-blue-600 text-white text-sm font-semibold px-4 py-2.5 rounded-xl flex-shrink-0 active:bg-blue-700 transition-colors"
            >
              <Check size={15} />
              Chọn
            </button>
          </div>
        ) : (
          <p className="w-full text-center text-sm text-slate-400">
            Tìm kiếm hoặc nhấn vào bản đồ để chọn địa điểm
          </p>
        )}
      </div>
    </div>
  );
}
