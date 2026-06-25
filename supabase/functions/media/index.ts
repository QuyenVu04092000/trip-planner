import { authenticate, json, preflight, SUPABASE_URL } from "../_shared/helpers.ts";

function buildUrls(storagePath: string, type: string) {
  const base = `${SUPABASE_URL}/storage/v1`;
  const publicUrl = `${base}/object/public/trip-media/${storagePath}`;
  const thumbnailUrl = type === "image"
    ? `${base}/render/image/public/trip-media/${storagePath}?width=800&quality=75&resize=contain`
    : publicUrl;
  return { publicUrl, thumbnailUrl };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();

  const auth = await authenticate(req);
  if (!auth) return json({ error: "Unauthorized" }, 401);
  const { sb } = auth;

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const tripId = url.searchParams.get("tripId");

  try {
    // GET /media?tripId=  → fetchMediaItems metadata
    if (req.method === "GET") {
      if (!tripId) return json({ error: "Missing tripId" }, 400);
      const { data, error } = await sb
        .from("media_items").select("*").eq("trip_id", tripId)
        .order("created_at", { ascending: true });
      if (error) return json({ error: error.message }, 400);

      const items = (data ?? []).map((r: Record<string, unknown>) => {
        const { publicUrl, thumbnailUrl } = buildUrls(
          r.storage_path as string,
          r.type as string,
        );
        return { ...r, publicUrl, thumbnailUrl };
      });
      return json(items);
    }

    // POST /media  → insert metadata row (file already uploaded to Storage by client)
    if (req.method === "POST") {
      const body = await req.json();
      const { error } = await sb.from("media_items").insert(body);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true }, 201);
    }

    // PUT /media?id=  → update caption
    if (req.method === "PUT") {
      if (!id) return json({ error: "Missing id" }, 400);
      const { caption } = await req.json();
      const { error } = await sb.from("media_items").update({ caption }).eq("id", id);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    // DELETE /media?id=  → delete storage file + DB row
    if (req.method === "DELETE") {
      if (!id) return json({ error: "Missing id" }, 400);
      const { data: row } = await sb
        .from("media_items").select("storage_path, thumbnail_path").eq("id", id).single();
      if (row) {
        const paths: string[] = [];
        if ((row as { storage_path?: string }).storage_path)
          paths.push((row as { storage_path: string }).storage_path);
        if ((row as { thumbnail_path?: string }).thumbnail_path)
          paths.push((row as { thumbnail_path: string }).thumbnail_path);
        if (paths.length) await sb.storage.from("trip-media").remove(paths);
      }
      const { error } = await sb.from("media_items").delete().eq("id", id);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    return json({ error: "Method not allowed" }, 405);
  } catch (err) {
    console.error("[media]", err);
    return json({ error: String(err) }, 500);
  }
});
