import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Geolocation, type Position } from "@capacitor/geolocation";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import {
  X, Volume2, VolumeX, LocateFixed, Loader2, ArrowUp, CornerUpLeft, CornerUpRight,
  ArrowUpLeft, ArrowUpRight, RotateCw, Flag,
} from "lucide-react";
import {
  MAPBOX_TOKEN, getRoute, meters, distanceToPath, formatDistance, formatDuration,
  type LatLon, type RouteStep,
} from "../utils/mapbox";

mapboxgl.accessToken = MAPBOX_TOKEN;

// Dẫn đường NGAY TRONG APP (không nhảy sang Google Maps): bản đồ Mapbox, tuyến lái
// xe thật (có tính kẹt xe), chấm vị trí realtime, chỉ dẫn từng bước + đọc giọng nói,
// tự tính lại tuyến khi đi lệch. Hỗ trợ nhiều điểm dừng (dẫn cả ngày theo thứ tự).

export interface NavStop {
  name: string;
  lat: number;
  lon: number;
}

interface Props {
  stops: NavStop[];
  onClose: () => void;
}

interface FlatStep extends RouteStep {
  stop: number; // index điểm dừng (trong `stops`) mà bước này dẫn tới
}

const STEP_DONE_M = 25;       // cách chỗ rẽ < 25m → sang bước kế
const ANNOUNCE_M = 120;       // còn ~120m tới chỗ rẽ → nhắc lại bằng giọng nói
const ARRIVE_M = 40;          // cách điểm dừng < 40m → coi như đã tới
const OFF_ROUTE_M = 60;       // lệch tuyến > 60m …
const OFF_ROUTE_HITS = 2;     // … 2 lần liên tiếp → tính lại tuyến
const REROUTE_GAP_MS = 15000; // tối thiểu 15s giữa 2 lần tính lại (tiết kiệm API)
const MAX_GPS_ERR_M = 80;     // GPS sai số lớn hơn → bỏ qua kiểm tra lệch tuyến
const ROUTE_COLOR = "#1A73E8";

function ManeuverIcon({ type, modifier, size = 30 }: { type?: string; modifier?: string; size?: number }) {
  const m = modifier ?? "";
  if (type === "arrive") return <Flag size={size} />;
  if (m === "uturn" || type === "roundabout" || type === "rotary") return <RotateCw size={size} />;
  if (m === "slight left") return <ArrowUpLeft size={size} />;
  if (m === "slight right") return <ArrowUpRight size={size} />;
  if (m.includes("left")) return <CornerUpLeft size={size} />;
  if (m.includes("right")) return <CornerUpRight size={size} />;
  return <ArrowUp size={size} />;
}

// Hướng đi (độ) từ a → b, khi GPS không trả heading.
function bearing(a: LatLon, b: LatLon): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(b.lon - a.lon)) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lon - a.lon));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function stopMarkerEl(n: number): HTMLElement {
  const el = document.createElement("div");
  el.textContent = String(n);
  el.style.cssText =
    "width:26px;height:26px;border-radius:9999px;background:#C4622D;color:#fff;font:700 12px/26px system-ui;" +
    "text-align:center;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)";
  return el;
}

function userMarkerEl(): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML =
    `<svg width="34" height="34" viewBox="0 0 34 34"><circle cx="17" cy="17" r="15" fill="${ROUTE_COLOR}" ` +
    `stroke="#fff" stroke-width="3"/><path d="M17 8 L24 23 L17 19 L10 23 Z" fill="#fff"/></svg>`;
  el.style.cssText = "filter:drop-shadow(0 1px 3px rgba(0,0,0,.35))";
  return el;
}

type Status = "locating" | "routing" | "navigating" | "arrived" | "error";

export default function NavigationView({ stops, onClose }: Props) {
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const userMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const watchIdRef = useRef<string | null>(null);

  // Trạng thái dẫn đường (ref → dùng trong callback GPS không bị stale).
  const pathRef = useRef<LatLon[]>([]);
  const stepsRef = useRef<FlatStep[]>([]);
  const stepIdxRef = useRef(0);
  const nextStopRef = useRef(0);
  const announcedRef = useRef(-1);
  const offHitsRef = useRef(0);
  const lastRerouteRef = useRef(0);
  const routingRef = useRef(false);
  const followRef = useRef(true);
  const mutedRef = useRef(false);
  const posRef = useRef<LatLon | null>(null);
  const headingRef = useRef(0);
  const styleReadyRef = useRef(false);
  const pendingPathRef = useRef<LatLon[] | null>(null);

  const [status, setStatus] = useState<Status>("locating");
  const [error, setError] = useState("");
  const [stepIdx, setStepIdx] = useState(0);
  const [steps, setSteps] = useState<FlatStep[]>([]);
  const [nextStop, setNextStop] = useState(0);
  const [toTurnM, setToTurnM] = useState(0);
  const [remain, setRemain] = useState({ m: 0, sec: 0 });
  const [muted, setMuted] = useState(false);
  const [follow, setFollow] = useState(true);

  function speak(text: string) {
    if (mutedRef.current || !text || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "vi-VN";
    window.speechSynthesis.speak(u);
  }

  // Đang đi trên bước k → chỗ rẽ sắp tới = thao tác của bước k+1.
  function upcoming(k: number, list = stepsRef.current) {
    const nxt = list[k + 1];
    if (!nxt) return { text: "", type: "", modifier: "" };
    if (nxt.type === "arrive") {
      return { text: `Đến ${stops[nxt.stop]?.name ?? "nơi"}`, type: "arrive", modifier: "" };
    }
    return { text: nxt.instruction, type: nxt.type, modifier: nxt.modifier };
  }

  // Điểm cuối của bước k = chỗ thao tác của bước kế (hoặc cuối tuyến).
  function stepEnd(k: number, list = stepsRef.current): LatLon | null {
    return list[k + 1]?.at ?? pathRef.current[pathRef.current.length - 1] ?? null;
  }

  function updateRemaining(p: LatLon) {
    const list = stepsRef.current;
    const k = stepIdxRef.current;
    const cur = list[k];
    const end = stepEnd(k);
    if (!cur || !end) return;
    const toEnd = meters(p, end);
    let m = toEnd;
    let sec = cur.distance > 0 ? cur.duration * Math.min(1, toEnd / cur.distance) : 0;
    for (let i = k + 1; i < list.length; i++) {
      m += list[i].distance;
      sec += list[i].duration;
    }
    setToTurnM(toEnd);
    setRemain({ m, sec });
  }

  function drawRoute(path: LatLon[]) {
    const map = mapRef.current;
    if (!map) return;
    // Style chưa tải xong → để dành, vẽ khi "style.load" (xem useEffect).
    if (!styleReadyRef.current) {
      pendingPathRef.current = path;
      return;
    }
    const data: GeoJSON.Feature = {
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: path.map((p) => [p.lon, p.lat]) },
    };
    const src = map.getSource("route") as mapboxgl.GeoJSONSource | undefined;
    if (src) {
      src.setData(data);
    } else {
      map.addSource("route", { type: "geojson", data });
      map.addLayer({
        id: "route-casing",
        type: "line",
        source: "route",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": "#0B4FB3", "line-width": 10 },
      });
      map.addLayer({
        id: "route",
        type: "line",
        source: "route",
        layout: { "line-join": "round", "line-cap": "round" },
        paint: { "line-color": ROUTE_COLOR, "line-width": 7 },
      });
    }
  }

  async function buildRoute(from: LatLon, fit: boolean) {
    const remaining = stops.slice(nextStopRef.current);
    if (remaining.length === 0) return;
    const map0 = mapRef.current;
    routingRef.current = true;
    if (fit) setStatus("routing");
    try {
      const r = await getRoute([from, ...remaining.map((s) => ({ lat: s.lat, lon: s.lon }))]);
      // Đã đóng / StrictMode mount lại → bỏ kết quả của lượt cũ.
      if (!map0 || mapRef.current !== map0) return;
      if (!r || r.path.length < 2) throw new Error("Không tìm được đường đi");

      pathRef.current = r.path;
      const flat: FlatStep[] = r.legs.flatMap((leg, li) =>
        leg.steps.map((s) => ({ ...s, stop: nextStopRef.current + li })),
      );
      stepsRef.current = flat;
      stepIdxRef.current = 0;
      announcedRef.current = -1;
      offHitsRef.current = 0;
      setSteps(flat);
      setStepIdx(0);

      drawRoute(r.path);
      const map = mapRef.current;
      if (map && fit) {
        const b = new mapboxgl.LngLatBounds();
        r.path.forEach((p) => b.extend([p.lon, p.lat]));
        map.fitBounds(b, { padding: 60, duration: 600 });
      }
      setStatus("navigating");
      updateRemaining(from);
      if (flat[0]) speak(flat[0].instruction);
    } catch (e) {
      console.error("[nav] route failed:", e);
      if (fit) {
        setError(e instanceof Error ? e.message : "Không tìm được đường đi");
        setStatus("error");
      }
    } finally {
      routingRef.current = false;
      lastRerouteRef.current = Date.now();
    }
  }

  function onPosition(pos: Position) {
    if (!mapRef.current) return;
    const p: LatLon = { lat: pos.coords.latitude, lon: pos.coords.longitude };
    const prev = posRef.current;
    posRef.current = p;
    const map = mapRef.current;

    // Mũi tên theo hướng đi: GPS có heading thì dùng, không thì tự tính từ 2 lần đo.
    const h = pos.coords.heading;
    if (h != null && Number.isFinite(h)) headingRef.current = h;
    else if (prev && meters(prev, p) > 5) headingRef.current = bearing(prev, p);

    if (map) {
      if (!userMarkerRef.current) {
        userMarkerRef.current = new mapboxgl.Marker({ element: userMarkerEl(), rotationAlignment: "map" })
          .setLngLat([p.lon, p.lat])
          .addTo(map);
      } else {
        userMarkerRef.current.setLngLat([p.lon, p.lat]);
      }
      userMarkerRef.current.setRotation(headingRef.current);
      if (followRef.current && stepsRef.current.length) {
        map.easeTo({ center: [p.lon, p.lat], duration: 600 });
      }
    }

    if (routingRef.current || stepsRef.current.length === 0) return;

    // Tới điểm dừng? Toạ độ điểm dừng có thể nằm sâu trong khuôn viên (VD giữa quảng
    // trường), còn tuyến chỉ tới mép đường gần nhất → so cả với điểm cuối chặng.
    const stop = stops[nextStopRef.current];
    const legEnd = stepsRef.current.find((s) => s.type === "arrive" && s.stop === nextStopRef.current)?.at;
    if (stop && (meters(p, stop) < ARRIVE_M || (legEnd && meters(p, legEnd) < ARRIVE_M))) {
      nextStopRef.current += 1;
      setNextStop(nextStopRef.current);
      if (nextStopRef.current >= stops.length) {
        speak(`Đã đến ${stop.name}. Kết thúc dẫn đường.`);
        setStatus("arrived");
        return;
      }
      speak(`Đã đến ${stop.name}. Tiếp tục tới ${stops[nextStopRef.current].name}.`);
      const firstOfNext = stepsRef.current.findIndex((s) => s.stop >= nextStopRef.current);
      if (firstOfNext >= 0) {
        stepIdxRef.current = firstOfNext;
        setStepIdx(firstOfNext);
      }
    }

    // Qua chỗ rẽ → sang bước kế.
    const list = stepsRef.current;
    let k = stepIdxRef.current;
    while (k < list.length - 1) {
      const end = stepEnd(k);
      if (!end || meters(p, end) >= STEP_DONE_M) break;
      k++;
    }
    const end = stepEnd(k);
    if (k !== stepIdxRef.current) {
      stepIdxRef.current = k;
      setStepIdx(k);
      const up = upcoming(k);
      // Chỗ rẽ kế đã ở gần → đọc thẳng 1 lần (khỏi "Sau 70 m…" rồi lại nhắc).
      if (end && meters(p, end) < ANNOUNCE_M) {
        announcedRef.current = k;
        speak(up.text);
      } else if (up.text) {
        speak(`Sau ${formatDistance(list[k].distance)}, ${up.text}`);
      }
    }

    // Sắp tới chỗ rẽ → nhắc lại.
    if (end && announcedRef.current !== k && meters(p, end) < ANNOUNCE_M) {
      announcedRef.current = k;
      speak(upcoming(k).text);
    }

    // Lệch tuyến → tính lại (bỏ qua khi GPS kém chính xác).
    if ((pos.coords.accuracy ?? 0) <= MAX_GPS_ERR_M) {
      const off = distanceToPath(p, pathRef.current) > OFF_ROUTE_M;
      offHitsRef.current = off ? offHitsRef.current + 1 : 0;
      if (offHitsRef.current >= OFF_ROUTE_HITS && Date.now() - lastRerouteRef.current > REROUTE_GAP_MS) {
        speak("Đang tính lại tuyến đường");
        void buildRoute(p, false);
        return;
      }
    }

    updateRemaining(p);
  }

  async function start() {
    setError("");
    setStatus("locating");
    // Mỗi lượt gắn với 1 instance bản đồ; instance đổi (đóng / StrictMode mount lại)
    // → lượt cũ dừng sau mỗi await, không đăng ký GPS thừa.
    const map0 = mapRef.current;
    const stale = () => !map0 || mapRef.current !== map0;
    try {
      if (Capacitor.isNativePlatform()) {
        const perm = await Geolocation.requestPermissions().catch(() => null);
        if (perm && perm.location === "denied") throw new Error("Bạn chưa cho phép truy cập vị trí");
      }
      const first = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 20000 });
      if (stale()) return;
      onPosition(first);
      const p = { lat: first.coords.latitude, lon: first.coords.longitude };
      await buildRoute(p, true);
      if (!watchIdRef.current && !stale()) {
        const id = await Geolocation.watchPosition(
          { enableHighAccuracy: true, timeout: 20000, maximumAge: 2000 },
          (pos) => { if (pos) onPosition(pos); },
        );
        if (stale()) void Geolocation.clearWatch({ id });
        else watchIdRef.current = id;
      }
    } catch (e) {
      console.error("[nav] start failed:", e);
      const msg = e instanceof Error ? e.message : (e as { message?: string })?.message;
      setError(
        /denied/i.test(msg ?? "") ? "Bạn chưa cho phép truy cập vị trí" : msg || "Không lấy được vị trí",
      );
      setStatus("error");
    }
  }

  // Khởi tạo bản đồ + điểm dừng, rồi bắt đầu dẫn đường.
  useEffect(() => {
    if (!mapDivRef.current || mapRef.current) return;
    const map = new mapboxgl.Map({
      container: mapDivRef.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: [stops[0].lon, stops[0].lat],
      zoom: 15,
      language: "vi",
    });
    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");

    // Người dùng kéo bản đồ → tạm ngừng bám theo vị trí (có nút căn giữa lại).
    map.on("dragstart", () => {
      followRef.current = false;
      setFollow(false);
    });

    const markers = stops.map((s, i) =>
      new mapboxgl.Marker({ element: stopMarkerEl(i + 1) }).setLngLat([s.lon, s.lat]).addTo(map),
    );

    // Lấy vị trí + tìm đường ngay, không chờ tile ("load" chỉ bắn khi MỌI tile tải
    // xong — mạng chậm sẽ treo). Riêng nét tuyến cần style → vẽ khi style sẵn sàng.
    map.once("style.load", () => {
      styleReadyRef.current = true;
      if (pendingPathRef.current) {
        drawRoute(pendingPathRef.current);
        pendingPathRef.current = null;
      }
    });
    void start();

    return () => {
      styleReadyRef.current = false;
      pendingPathRef.current = null;
      if (watchIdRef.current) void Geolocation.clearWatch({ id: watchIdRef.current });
      watchIdRef.current = null;
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      markers.forEach((m) => m.remove());
      userMarkerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function recenter() {
    followRef.current = true;
    setFollow(true);
    const p = posRef.current;
    if (p && mapRef.current) mapRef.current.easeTo({ center: [p.lon, p.lat], zoom: 17, duration: 600 });
  }

  function toggleMute() {
    mutedRef.current = !mutedRef.current;
    setMuted(mutedRef.current);
    if (mutedRef.current && "speechSynthesis" in window) window.speechSynthesis.cancel();
  }

  const up = upcoming(stepIdx, steps);
  const eta = new Date(Date.now() + remain.sec * 1000).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
  const curStop = stops[Math.min(nextStop, stops.length - 1)];

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      {/* Chỉ dẫn sắp tới */}
      <div className="bg-[#1E2A36] text-white px-4 pt-safe-4 pb-4 z-20 shadow-lg">
        {status === "navigating" ? (
          <div className="flex items-center gap-4">
            <div className="flex-shrink-0">
              <ManeuverIcon type={up.type} modifier={up.modifier} />
            </div>
            <div className="min-w-0">
              <p className="text-2xl font-bold leading-tight">{formatDistance(toTurnM)}</p>
              <p className="text-sm text-white/85 leading-snug line-clamp-2">{up.text}</p>
            </div>
          </div>
        ) : status === "arrived" ? (
          <div className="flex items-center gap-3">
            <Flag size={28} />
            <p className="text-lg font-bold">Đã đến nơi 🎉</p>
          </div>
        ) : status === "error" ? (
          <p className="text-sm">{error || "Có lỗi xảy ra"}</p>
        ) : (
          <div className="flex items-center gap-2 text-sm">
            <Loader2 size={16} className="animate-spin" />
            {status === "locating" ? "Đang lấy vị trí của bạn…" : "Đang tìm đường…"}
          </div>
        )}
      </div>

      {/* Bản đồ */}
      {/* Không dùng absolute cho div bản đồ: mapbox-gl.css ép .mapboxgl-map
          position:relative → cao 0. Dùng flex để div tự giãn. */}
      <div className="relative flex-1 min-h-0 flex flex-col">
        <div ref={mapDivRef} className="flex-1 min-h-0" />
        {!follow && status === "navigating" && (
          <button
            onClick={recenter}
            className="absolute right-3 bottom-8 z-10 flex items-center gap-1.5 bg-white text-ink text-sm font-semibold px-3 py-2 rounded-full shadow-lg"
          >
            <LocateFixed size={16} /> Căn giữa
          </button>
        )}
      </div>

      {/* Thông tin chuyến + điều khiển */}
      <div className="px-4 py-3 pb-safe-5 bg-white border-t border-sand z-20">
        {status === "navigating" && (
          <div className="flex items-baseline justify-between mb-2">
            <p className="text-lg font-bold text-ink">
              {formatDuration(remain.sec)}{" "}
              <span className="text-sm font-medium text-stone">· {formatDistance(remain.m)}</span>
            </p>
            <p className="text-sm text-stone">Đến lúc {eta}</p>
          </div>
        )}
        {stops.length > 1 && curStop && status !== "arrived" && (
          <p className="text-xs text-stone mb-2 truncate">
            Điểm {Math.min(nextStop + 1, stops.length)}/{stops.length}:{" "}
            <span className="text-ink font-medium">{curStop.name}</span>
          </p>
        )}
        <div className="flex items-center gap-2">
          <button
            onClick={toggleMute}
            className="w-11 h-11 flex items-center justify-center rounded-xl bg-parchment text-ink"
            aria-label={muted ? "Bật giọng nói" : "Tắt giọng nói"}
          >
            {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
          {status === "error" && (
            <button
              onClick={() => void start()}
              className="flex-1 h-11 rounded-xl bg-terra text-white text-sm font-semibold"
            >
              Thử lại
            </button>
          )}
          <button
            onClick={onClose}
            className="flex-1 h-11 flex items-center justify-center gap-1.5 rounded-xl bg-wine text-white text-sm font-semibold"
          >
            <X size={16} /> {status === "arrived" ? "Đóng" : "Kết thúc"}
          </button>
        </div>
      </div>
    </div>
  );
}
