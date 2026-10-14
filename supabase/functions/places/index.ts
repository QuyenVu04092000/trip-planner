// Supabase Edge Function: places
// Proxy Google Places API (New) + Geocoding — giấu GOOGLE_MAPS_API_KEY ở server,
// tránh CORS, và chặn người lạ xài chùa key (bắt buộc đăng nhập).
//
//   GET ?op=autocomplete&q=...&session=...  → gợi ý địa điểm (toàn cầu)
//   GET ?op=details&placeId=...&session=... → toạ độ + địa chỉ của 1 địa điểm
//   GET ?op=reverse&lat=..&lon=..           → địa chỉ từ toạ độ (click thả ghim)

import { authenticate, json, preflight } from "../_shared/helpers.ts";

const GOOGLE_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY")!;

interface AutocompleteItem {
  placeId: string;
  mainText: string;
  secondaryText: string;
}

async function autocomplete(q: string, session: string): Promise<AutocompleteItem[]> {
  const res = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": GOOGLE_KEY,
    },
    // KHÔNG includedRegionCodes → tìm toàn cầu. languageCode vi cho ưu tiên tiếng Việt.
    body: JSON.stringify({ input: q, sessionToken: session, languageCode: "vi" }),
  });
  if (!res.ok) throw new Error(`autocomplete HTTP ${res.status}`);
  const data = await res.json();
  const out: AutocompleteItem[] = [];
  for (const s of data.suggestions ?? []) {
    const p = s.placePrediction;
    if (!p?.placeId) continue;
    out.push({
      placeId: p.placeId,
      mainText: p.structuredFormat?.mainText?.text ?? p.text?.text ?? "",
      secondaryText: p.structuredFormat?.secondaryText?.text ?? "",
    });
  }
  return out;
}

async function details(placeId: string, session: string) {
  const url = new URL(`https://places.googleapis.com/v1/places/${placeId}`);
  if (session) url.searchParams.set("sessionToken", session);
  const res = await fetch(url.toString(), {
    headers: {
      "X-Goog-Api-Key": GOOGLE_KEY,
      "X-Goog-FieldMask": "id,displayName,location,formattedAddress",
    },
  });
  if (!res.ok) throw new Error(`details HTTP ${res.status}`);
  const d = await res.json();
  return {
    placeId: d.id ?? placeId,
    name: d.displayName?.text ?? "",
    address: d.formattedAddress ?? "",
    lat: d.location?.latitude ?? null,
    lon: d.location?.longitude ?? null,
  };
}

// Forward geocode 1 địa chỉ (chữ) → toạ độ. Dùng để prefill ghim từ địa chỉ đã lưu.
async function geocodeForward(q: string) {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", q);
  url.searchParams.set("language", "vi");
  url.searchParams.set("key", GOOGLE_KEY);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`geocode HTTP ${res.status}`);
  const d = await res.json();
  const r = d.results?.[0];
  if (!r) return { lat: null, lon: null, address: "", placeId: null };
  return {
    lat: r.geometry?.location?.lat ?? null,
    lon: r.geometry?.location?.lng ?? null,
    address: r.formatted_address ?? "",
    placeId: r.place_id ?? null,
  };
}

async function reverse(lat: string, lon: string) {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("latlng", `${lat},${lon}`);
  url.searchParams.set("language", "vi");
  url.searchParams.set("key", GOOGLE_KEY);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`reverse HTTP ${res.status}`);
  const d = await res.json();
  const r = d.results?.[0];
  return {
    address: r?.formatted_address ?? "",
    placeId: r?.place_id ?? null,
    lat: r?.geometry?.location?.lat ?? Number(lat),
    lon: r?.geometry?.location?.lng ?? Number(lon),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();

  const auth = await authenticate(req);
  if (!auth) return json({ error: "Unauthorized" }, 401);

  try {
    const url = new URL(req.url);
    const op = url.searchParams.get("op");

    if (op === "autocomplete") {
      const q = (url.searchParams.get("q") ?? "").trim();
      const session = url.searchParams.get("session") ?? "";
      if (q.length < 2) return json({ items: [] });
      return json({ items: await autocomplete(q, session) });
    }

    if (op === "details") {
      const placeId = url.searchParams.get("placeId") ?? "";
      const session = url.searchParams.get("session") ?? "";
      if (!placeId) return json({ error: "Missing placeId" }, 400);
      return json(await details(placeId, session));
    }

    if (op === "geocode") {
      const q = (url.searchParams.get("q") ?? "").trim();
      if (!q) return json({ error: "Missing q" }, 400);
      return json(await geocodeForward(q));
    }

    if (op === "reverse") {
      const lat = url.searchParams.get("lat") ?? "";
      const lon = url.searchParams.get("lon") ?? "";
      if (!lat || !lon) return json({ error: "Missing lat/lon" }, 400);
      return json(await reverse(lat, lon));
    }

    return json({ error: "Unknown op" }, 400);
  } catch (err) {
    console.error("[places] error:", err);
    return json({ error: String(err) }, 500);
  }
});
