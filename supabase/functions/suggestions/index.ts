import { authenticate, json, preflight } from "../_shared/helpers.ts";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;
const MAPBOX_TOKEN = Deno.env.get("MAPBOX_TOKEN")!;
const GEMINI_MODEL = "gemini-2.5-flash";
const CACHE_ENABLED = true; // cache theo (trip, user), TTL 7 ngày — đỡ gọi Gemini lặp lại
const DAILY_AI_LIMIT = 20;  // tối đa 20 lần sinh gợi ý/user/ngày
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 ngày

interface RawSuggestion {
  name: string;
  category: string;
  description: string;
  area?: string;
}
interface Suggestion extends RawSuggestion {
  address: string;
  lat: number | null;
  lon: number | null;
  photoUrl: string | null;
}

// Bỏ dấu + lowercase để so khớp tên
function normalize(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

// ── Wikimedia/Wikipedia: ảnh thật cho địa điểm nổi tiếng (free, không cần key) ──
// Có kiểm tra khớp tên để loại trường hợp search trả nhầm bài không liên quan.
async function fetchWikimediaPhoto(name: string, destination: string): Promise<string | null> {
  const query = `${name} ${destination}`;
  for (const lang of ["vi", "en"]) {
    try {
      const url =
        `https://${lang}.wikipedia.org/w/api.php?action=query&format=json` +
        `&prop=pageimages&piprop=thumbnail&pithumbsize=600` +
        `&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrlimit=1&origin=*`;
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      const pages = data?.query?.pages;
      if (!pages) continue;
      const page = Object.values(pages)[0] as {
        title?: string;
        thumbnail?: { source?: string };
      };
      const thumb = page?.thumbnail?.source;
      const title = page?.title;
      if (!thumb || !title) continue;

      // Kiểm tra bài Wikipedia thật sự khớp tên địa điểm (tránh ảnh sai)
      const target = normalize(name);
      const t = normalize(title.replace(/\(.*?\)/g, "")); // bỏ phần (...)
      const overlap =
        t.includes(target) ||
        target.includes(t) ||
        target.split(/\s+/).some((w) => w.length >= 4 && t.includes(w));
      if (overlap) return thumb;
    } catch {
      /* bỏ qua, thử lang tiếp theo */
    }
  }
  return null;
}

// ── Gemini: sinh danh sách chỗ nên đi (trộn quán ăn / cà phê / điểm / check-in) ──
async function askGemini(destination: string): Promise<RawSuggestion[]> {
  const prompt =
    `Bạn là chuyên gia du lịch Việt Nam. Gợi ý 8 địa điểm nên ghé khi đến "${destination}". ` +
    `Trộn nhiều loại: quán ăn ngon, quán cà phê đẹp, điểm tham quan nổi tiếng, ` +
    `và đặc biệt vài góc check-in / chỗ sống ảo đang hot trên mạng xã hội. ` +
    `Ưu tiên chỗ thật, cụ thể, đang được giới trẻ ưa thích.`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                name: { type: "STRING" },
                category: {
                  type: "STRING",
                  enum: ["food", "cafe", "attraction", "checkin"],
                },
                description: { type: "STRING" },
                area: { type: "STRING" },
              },
              required: ["name", "category", "description"],
            },
          },
        },
      }),
    },
  );

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Gemini ${res.status}: ${txt.slice(0, 300)}`);
  }
  const body = await res.json();
  const text = body?.candidates?.[0]?.content?.parts?.[0]?.text ?? "[]";
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Khoảng cách giữa 2 điểm (km) — dùng để loại kết quả geocode quá xa điểm đến
function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ── Mapbox: forward-geocode để lấy toạ độ + địa chỉ chuẩn ──
// Khi có `center`: giới hạn bbox quanh điểm đến + chọn kết quả gần nhất + loại nếu quá xa.
async function geocode(
  query: string,
  center?: { lon: number; lat: number },
  maxKm = 80,
): Promise<{ lat: number; lon: number; address: string } | null> {
  const limit = center ? 5 : 1;
  let url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json` +
    `?access_token=${MAPBOX_TOKEN}&language=vi&country=VN&limit=${limit}`;
  if (center) {
    const d = 0.6; // ~66km mỗi chiều → khoanh vùng tỉnh/thành quanh điểm đến
    url += `&proximity=${center.lon},${center.lat}`;
    url += `&bbox=${center.lon - d},${center.lat - d},${center.lon + d},${center.lat + d}`;
  }
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const features: Array<{ center: [number, number]; place_name?: string }> =
    data.features ?? [];
  if (features.length === 0) return null;

  if (!center) {
    const f = features[0];
    return { lon: f.center[0], lat: f.center[1], address: f.place_name ?? query };
  }

  // Chọn kết quả gần điểm đến nhất, loại nếu vượt maxKm
  let best: { lat: number; lon: number; address: string } | null = null;
  let bestKm = Infinity;
  for (const f of features) {
    const [lon, lat] = f.center;
    const km = haversineKm(center.lat, center.lon, lat, lon);
    if (km < bestKm) {
      bestKm = km;
      best = { lon, lat, address: f.place_name ?? query };
    }
  }
  return best && bestKm <= maxKm ? best : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();

  const auth = await authenticate(req);
  if (!auth) return json({ error: "Unauthorized" }, 401);
  const { sb, userId } = auth;

  try {
    const { tripId, destination, refresh } = await req.json();
    if (!tripId || !destination) {
      return json({ error: "Missing tripId or destination" }, 400);
    }

    // 1. Cache hit? (bảng cache là tuỳ chọn — nếu chưa tạo thì bỏ qua, không lỗi)
    if (CACHE_ENABLED && !refresh) {
      try {
        const { data: cached } = await sb
          .from("trip_suggestions")
          .select("data, created_at")
          .eq("trip_id", tripId)
          .eq("created_by", userId)
          .maybeSingle();
        if (cached) {
          const age = Date.now() - new Date(cached.created_at as string).getTime();
          if (age < CACHE_MAX_AGE_MS) return json(cached.data);
        }
      } catch (_) { /* bảng chưa tồn tại — bỏ qua cache */ }
    }

    // 1b. Rate-limit: tối đa N lần gọi AI/ngày (chỉ tính khi cache miss → gọi Gemini thật)
    const { data: underQuota } = await sb.rpc("check_ai_quota", { p_limit: DAILY_AI_LIMIT });
    if (underQuota === false) {
      return json({ error: "Đã đạt giới hạn gợi ý hôm nay. Thử lại vào ngày mai nhé." }, 429);
    }

    // 2. Gemini sinh danh sách
    const raw = await askGemini(destination);
    if (raw.length === 0) return json([]);

    // 3. Toạ độ trung tâm của điểm đến (để bias geocode)
    const center = await geocode(destination);

    // 4. Geocode từng chỗ + lấy ảnh (song song)
    const suggestions: Suggestion[] = await Promise.all(
      raw.map(async (s) => {
        const q = [s.name, s.area, destination].filter(Boolean).join(", ");
        const geo = await geocode(q, center ?? undefined);
        const lat = geo?.lat ?? null;
        const lon = geo?.lon ?? null;
        const photoUrl = await fetchWikimediaPhoto(s.name, destination);
        return {
          ...s,
          address: geo?.address ?? s.area ?? destination,
          lat,
          lon,
          photoUrl,
        };
      }),
    );

    // 5. Lưu cache (upsert) — bỏ qua nếu cache tắt hoặc bảng chưa tạo
    if (CACHE_ENABLED) {
      try {
        await sb.from("trip_suggestions").upsert(
          { trip_id: tripId, created_by: userId, data: suggestions, created_at: new Date().toISOString() },
          { onConflict: "trip_id,created_by" },
        );
      } catch (_) { /* bảng chưa tồn tại — bỏ qua cache */ }
    }

    return json(suggestions);
  } catch (err) {
    console.error("[suggestions]", err);
    return json({ error: String(err) }, 500);
  }
});
