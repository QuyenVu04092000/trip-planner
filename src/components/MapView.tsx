import { useEffect, useRef, useState, useCallback } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { X, Navigation, LocateFixed, Car, Footprints, Loader2 } from "lucide-react";

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN as string;
const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string;

interface Place {
  name: string;
  address?: string;
  lat?: number | null;
  lon?: number | null;
}

interface Props {
  place: Place;
  onClose: () => void;
}

type Profile = "driving" | "walking";

function fmtDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}
function fmtDuration(s: number): string {
  const min = Math.round(s / 60);
  if (min < 60) return `${min} phút`;
  const h = Math.floor(min / 60);
  return `${h} giờ ${min % 60} phút`;
}

async function geocode(q: string): Promise<{ lat: number; lon: number } | null> {
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${TOKEN}&language=vi&country=VN&limit=1`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const f = data.features?.[0];
  return f ? { lon: f.center[0], lat: f.center[1] } : null;
}

export default function MapView({ place, onClose }: Props) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const userMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const destRef = useRef<{ lat: number; lon: number } | null>(null);
  const userRef = useRef<{ lat: number; lon: number } | null>(null);
  const watchIdRef = useRef<number | null>(null);

  const [profile, setProfile] = useState<Profile>("driving");
  const [route, setRoute] = useState<{ distance: number; duration: number } | null>(null);
  const [routing, setRouting] = useState(false);
  const [locating, setLocating] = useState(false);
  const [tracking, setTracking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Init map + resolve destination coords
  useEffect(() => {
    if (!divRef.current || mapRef.current) return;
    const map = new mapboxgl.Map({
      container: divRef.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: [place.lon ?? 106.0, place.lat ?? 16.0],
      zoom: place.lat != null ? 14 : 5,
      language: "vi",
    });
    map.addControl(new mapboxgl.NavigationControl(), "top-right");
    mapRef.current = map;

    (async () => {
      let coords =
        place.lat != null && place.lon != null
          ? { lat: place.lat, lon: place.lon }
          : await geocode([place.name, place.address].filter(Boolean).join(", "));
      if (!coords) {
        setError("Không tìm được vị trí địa điểm này.");
        return;
      }
      destRef.current = coords;
      new mapboxgl.Marker({ color: "#e11d48" })
        .setLngLat([coords.lon, coords.lat])
        .setPopup(new mapboxgl.Popup({ offset: 24 }).setText(place.name))
        .addTo(map);
      map.flyTo({ center: [coords.lon, coords.lat], zoom: 14, duration: 0 });
    })();

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cập nhật (hoặc tạo) marker vị trí user
  const updateUserMarker = useCallback((loc: { lat: number; lon: number }) => {
    userRef.current = loc;
    const map = mapRef.current;
    if (!map) return;
    if (userMarkerRef.current) {
      userMarkerRef.current.setLngLat([loc.lon, loc.lat]);
    } else {
      userMarkerRef.current = new mapboxgl.Marker({ color: "#2563eb" })
        .setLngLat([loc.lon, loc.lat])
        .setPopup(new mapboxgl.Popup({ offset: 24 }).setText("Vị trí của bạn"))
        .addTo(map);
    }
  }, []);

  // Lấy vị trí 1 lần (dùng cho chỉ đường khi chưa bật theo dõi)
  const locate = useCallback((): Promise<{ lat: number; lon: number } | null> => {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        setError("Trình duyệt không hỗ trợ định vị.");
        resolve(null);
        return;
      }
      setLocating(true);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setLocating(false);
          const loc = { lat: pos.coords.latitude, lon: pos.coords.longitude };
          updateUserMarker(loc);
          resolve(loc);
        },
        () => {
          setLocating(false);
          setError("Không lấy được vị trí. Hãy cho phép quyền định vị.");
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 10000 },
      );
    });
  }, [updateUserMarker]);

  // Bật/tắt theo dõi vị trí real-time (chấm xanh chạy theo khi di chuyển)
  const stopTracking = useCallback(() => {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setTracking(false);
  }, []);

  const startTracking = useCallback(() => {
    if (!navigator.geolocation) {
      setError("Trình duyệt không hỗ trợ định vị.");
      return;
    }
    setError(null);
    setTracking(true);
    let first = true;
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        updateUserMarker(loc);
        if (first) {
          first = false;
          mapRef.current?.easeTo({ center: [loc.lon, loc.lat], zoom: 15, duration: 600 });
        }
      },
      () => {
        setError("Không lấy được vị trí. Hãy cho phép quyền định vị.");
        stopTracking();
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 },
    );
  }, [updateUserMarker, stopTracking]);

  // Dọn watch khi đóng map
  useEffect(() => {
    return () => {
      if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
    };
  }, []);

  // Vẽ tuyến đường lên bản đồ
  const drawRoute = useCallback((geojson: GeoJSON.Geometry) => {
    const map = mapRef.current;
    if (!map) return;
    const data = { type: "Feature", properties: {}, geometry: geojson } as GeoJSON.Feature;
    const src = map.getSource("route") as mapboxgl.GeoJSONSource | undefined;
    if (src) {
      src.setData(data);
    } else {
      map.addSource("route", { type: "geojson", data });
      map.addLayer({
        id: "route",
        type: "line",
        source: "route",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#2563eb", "line-width": 5, "line-opacity": 0.85 },
      });
    }
  }, []);

  // Chỉ đường từ vị trí user → địa điểm
  const getDirections = useCallback(
    async (prof: Profile) => {
      setError(null);
      const dest = destRef.current;
      if (!dest) return;
      let user = userRef.current;
      if (!user) {
        user = await locate();
        if (!user) return;
      }
      setRouting(true);
      try {
        const url =
          `https://api.mapbox.com/directions/v5/mapbox/${prof}/` +
          `${user.lon},${user.lat};${dest.lon},${dest.lat}` +
          `?geometries=geojson&overview=full&language=vi&access_token=${TOKEN}`;
        const res = await fetch(url);
        const data = await res.json();
        const r = data.routes?.[0];
        if (!r) {
          setError("Không tìm được tuyến đường.");
          return;
        }
        drawRoute(r.geometry);
        setRoute({ distance: r.distance, duration: r.duration });
        const map = mapRef.current;
        if (map) {
          const b = new mapboxgl.LngLatBounds();
          b.extend([user.lon, user.lat]);
          b.extend([dest.lon, dest.lat]);
          map.fitBounds(b, { padding: 80, duration: 500 });
        }
      } catch {
        setError("Lỗi khi lấy chỉ đường.");
      } finally {
        setRouting(false);
      }
    },
    [locate, drawRoute],
  );

  const switchProfile = (p: Profile) => {
    setProfile(p);
    if (route) void getDirections(p); // đã có tuyến → vẽ lại theo phương tiện mới
  };

  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 pt-safe">
        <button
          onClick={onClose}
          className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-500 hover:bg-slate-100 flex-shrink-0"
        >
          <X size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="font-bold text-slate-800 text-[15px] leading-tight truncate">{place.name}</h2>
          {place.address && (
            <p className="text-xs text-slate-400 leading-tight truncate">{place.address}</p>
          )}
        </div>
      </div>

      {/* Map */}
      <div className="relative flex-1">
        <div ref={divRef} className="absolute inset-0" />

        {/* Nút theo dõi vị trí real-time (bật/tắt) */}
        <button
          onClick={() => (tracking ? stopTracking() : startTracking())}
          title={tracking ? "Tắt theo dõi vị trí" : "Theo dõi vị trí real-time"}
          className={`absolute bottom-28 right-4 z-10 w-11 h-11 rounded-full shadow-lg flex items-center justify-center transition-colors ${
            tracking ? "bg-blue-600 text-white" : "bg-white text-blue-600 hover:bg-blue-50"
          }`}
        >
          {locating ? <Loader2 size={18} className="animate-spin" /> : <LocateFixed size={18} />}
        </button>

        {/* Badge đang theo dõi */}
        {tracking && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 bg-blue-600 text-white text-xs font-medium px-3 py-1.5 rounded-full shadow-lg">
            <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
            Đang theo dõi vị trí
          </div>
        )}
      </div>

      {/* Panel dưới: chỉ đường */}
      <div className="border-t border-slate-100 px-4 py-3 pb-safe space-y-3">
        {error && <p className="text-xs text-rose-500">{error}</p>}

        {route && (
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5 bg-slate-100 rounded-full p-0.5">
              <button
                onClick={() => switchProfile("driving")}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                  profile === "driving" ? "bg-white shadow-sm text-blue-600" : "text-slate-500"
                }`}
              >
                <Car size={13} /> Lái xe
              </button>
              <button
                onClick={() => switchProfile("walking")}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                  profile === "walking" ? "bg-white shadow-sm text-blue-600" : "text-slate-500"
                }`}
              >
                <Footprints size={13} /> Đi bộ
              </button>
            </div>
            <div className="text-sm">
              <span className="font-bold text-slate-800">{fmtDistance(route.distance)}</span>
              <span className="text-slate-400"> · {fmtDuration(route.duration)}</span>
            </div>
          </div>
        )}

        <button
          onClick={() => void getDirections(profile)}
          disabled={routing}
          className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold py-3 rounded-xl transition-colors"
        >
          {routing ? <Loader2 size={17} className="animate-spin" /> : <Navigation size={17} />}
          {route ? "Cập nhật chỉ đường" : "Chỉ đường từ vị trí của tôi"}
        </button>
      </div>
    </div>
  );
}
