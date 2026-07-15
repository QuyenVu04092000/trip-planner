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
  bestTime?: string;   // sáng / chiều / tối / cả ngày
  duration?: string;   // vd "1-2 giờ"
  priceLevel?: string; // miễn phí / ₫ / ₫₫ / ₫₫₫
}
interface Suggestion extends RawSuggestion {
  address: string;
  lat: number | null;
  lon: number | null;
  photoUrl: string | null;
}

// Tuỳ chọn cá nhân hoá từ client
interface Prefs {
  companions?: string;   // một mình / cặp đôi / gia đình / nhóm bạn
  interests?: string[];  // ăn uống, cà phê, thiên nhiên, sống ảo, văn hoá
  exclude?: string[];    // tên các chỗ đã có trong lịch trình → không gợi ý lại
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

// ── Gemini: sinh danh sách chỗ nên đi, cá nhân hoá theo prefs ──
async function askGemini(destination: string, prefs: Prefs): Promise<RawSuggestion[]> {
  let prompt =
    `Bạn là chuyên gia du lịch Việt Nam. Gợi ý 8 địa điểm nên ghé khi đến "${destination}". ` +
    `Trộn nhiều loại: quán ăn ngon, quán cà phê đẹp, điểm tham quan nổi tiếng, ` +
    `và đặc biệt vài góc check-in / chỗ sống ảo đang hot trên mạng xã hội. ` +
    `Ưu tiên chỗ thật, cụ thể, đang được giới trẻ ưa thích.`;

  if (prefs.companions) {
    prompt += ` Chuyến đi dạng: ${prefs.companions} — chọn chỗ phù hợp với nhóm này.`;
  }
  if (prefs.interests && prefs.interests.length > 0) {
    prompt += ` Người dùng đặc biệt thích: ${prefs.interests.join(", ")} — ưu tiên mạnh các loại này.`;
  }
  if (prefs.exclude && prefs.exclude.length > 0) {
    prompt += ` TUYỆT ĐỐI KHÔNG gợi ý lại các chỗ sau (đã có trong lịch trình): ${prefs.exclude.slice(0, 30).join("; ")}.`;
  }
  prompt +=
    ` Với mỗi chỗ, cho biết thêm: bestTime (thời điểm nên đi: sáng/chiều/tối/cả ngày), ` +
    `duration (chơi khoảng bao lâu, vd "1-2 giờ"), priceLevel (miễn phí/₫/₫₫/₫₫₫ — ₫ là rẻ, ₫₫₫ là đắt).`;

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
                bestTime: {
                  type: "STRING",
                  enum: ["sáng", "chiều", "tối", "cả ngày"],
                },
                duration: { type: "STRING" },
                priceLevel: {
                  type: "STRING",
                  enum: ["miễn phí", "₫", "₫₫", "₫₫₫"],
                },
              },
              required: ["name", "category", "description", "bestTime", "duration", "priceLevel"],
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
    const { tripId, destination, refresh, companions, interests, exclude } = await req.json();
    if (!tripId || !destination) {
      return json({ error: "Missing tripId or destination" }, 400);
    }
    const prefs: Prefs = {
      companions: typeof companions === "string" ? companions : undefined,
      interests: Array.isArray(interests) ? interests.slice(0, 10) : undefined,
      exclude: Array.isArray(exclude) ? exclude.slice(0, 50) : undefined,
    };
    // Khoá cache: điểm đến + cá nhân hoá (KHÔNG gồm exclude — danh sách đó đổi
    // liên tục; client tự lọc trùng phía hiển thị).
    const paramsKey = JSON.stringify({
      d: destination,
      c: prefs.companions ?? "",
      i: [...(prefs.interests ?? [])].sort(),
    });

    // 1. Cache hit? — chỉ dùng khi params khớp (đổi điểm đến/tuỳ chọn → miss)
    if (CACHE_ENABLED && !refresh) {
      try {
        const { data: cached } = await sb
          .from("trip_suggestions")
          .select("data, created_at, params")
          .eq("trip_id", tripId)
          .eq("created_by", userId)
          .maybeSingle();
        if (cached && cached.params === paramsKey) {
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

    // 2. Gemini sinh danh sách (cá nhân hoá + loại chỗ đã có trong lịch)
    const raw = await askGemini(destination, prefs);
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
          { trip_id: tripId, created_by: userId, data: suggestions, params: paramsKey, created_at: new Date().toISOString() },
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
