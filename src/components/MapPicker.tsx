import { useEffect, useRef, useState, useCallback } from 'react';
import { X, MapPin, Check, Search, Loader2 } from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix Leaflet marker icons in Vite
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

interface Props {
  onSelect: (address: string) => void;
  onClose:  () => void;
}

interface Result {
  display_name: string;
  lat: string;
  lon: string;
}

async function searchNominatim(q: string): Promise<Result[]> {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=6&accept-language=vi&countrycodes=vn`;
  const res = await fetch(url, { headers: { 'Accept-Language': 'vi' } });
  if (!res.ok) return [];
  return res.json();
}

async function reverseGeocode(lat: number, lon: number): Promise<string> {
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=vi`;
  const res = await fetch(url, { headers: { 'Accept-Language': 'vi' } });
  if (!res.ok) return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  const data = await res.json();
  return data.display_name ?? `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

export default function MapPicker({ onSelect, onClose }: Props) {
  const mapDivRef    = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<L.Map | null>(null);
  const markerRef    = useRef<L.Marker | null>(null);
  const debounceRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [query, setQuery]               = useState('');
  const [results, setResults]           = useState<Result[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [searching, setSearching]       = useState(false);
  const [selectedAddress, setSelectedAddress] = useState('');
  const [reversing, setReversing]       = useState(false);

  // Init Leaflet map
  useEffect(() => {
    if (!mapDivRef.current || mapRef.current) return;

    const map = L.map(mapDivRef.current, {
      center: [16.0, 106.0],
      zoom: 6,
      zoomControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    map.on('click', async (e) => {
      const { lat, lng } = e.latlng;
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

  function placeMarker(map: L.Map, lat: number, lng: number) {
    markerRef.current?.remove();
    markerRef.current = L.marker([lat, lng]).addTo(map);
    map.setView([lat, lng], Math.max(map.getZoom(), 15));
  }

  const handleSearch = useCallback((value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value.trim() || value.length < 2) {
      setResults([]); setShowDropdown(false); return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await searchNominatim(value);
        setResults(data);
        setShowDropdown(data.length > 0);
      } finally {
        setSearching(false);
      }
    }, 400);
  }, []);

  function selectResult(r: Result) {
    const lat = parseFloat(r.lat);
    const lng = parseFloat(r.lon);
    if (mapRef.current) placeMarker(mapRef.current, lat, lng);
    setSelectedAddress(r.display_name);
    setQuery(r.display_name);
    setShowDropdown(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">

      {/* Header */}
      <div className="flex items-center gap-2 px-4 pt-safe-4 pb-3 bg-white shadow-sm z-20">
        <button onClick={onClose}
          className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 transition-colors flex-shrink-0">
          <X size={18} />
        </button>
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none" />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={e => handleSearch(e.target.value)}
            onFocus={() => { if (results.length > 0) setShowDropdown(true); }}
            placeholder="Tìm địa điểm..."
            autoComplete="off"
            className="w-full pl-8 pr-8 py-2.5 bg-slate-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:bg-white border border-transparent focus:border-blue-400 transition-all placeholder:text-slate-400"
          />
          {searching && <Loader2 size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 animate-spin" />}
        </div>
      </div>

      {/* Dropdown */}
      {showDropdown && results.length > 0 && (
        <div className="absolute left-0 right-0 z-30 bg-white border-b border-slate-100 shadow-lg max-h-64 overflow-y-auto" style={{ top: '4.5rem' }}>
          {results.map((r, i) => (
            <button key={i} onMouseDown={() => selectResult(r)}
              className="w-full flex items-start gap-2.5 px-4 py-3 hover:bg-slate-50 transition-colors text-left border-b border-slate-50 last:border-0">
              <MapPin size={13} className="flex-shrink-0 text-slate-300 mt-0.5" />
              <span className="text-sm text-slate-700 leading-snug">{r.display_name}</span>
            </button>
          ))}
        </div>
      )}

      {/* Map */}
      <div ref={mapDivRef} className="flex-1 z-10" />

      {/* Footer */}
      <div className="px-4 py-3 pb-safe-5 bg-white border-t border-slate-100 min-h-[72px] flex items-center z-20">
        {reversing ? (
          <div className="w-full flex items-center justify-center gap-2 text-slate-400 text-sm">
            <Loader2 size={14} className="animate-spin" /> Đang lấy địa chỉ...
          </div>
        ) : selectedAddress ? (
          <div className="flex items-center gap-3 w-full">
            <MapPin size={16} className="flex-shrink-0 text-blue-500" />
            <p className="flex-1 text-sm text-slate-700 leading-snug line-clamp-2">{selectedAddress}</p>
            <button onClick={() => onSelect(selectedAddress)}
              className="flex items-center gap-1.5 bg-blue-600 text-white text-sm font-semibold px-4 py-2.5 rounded-xl flex-shrink-0 active:bg-blue-700 transition-colors">
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
