import { authenticate, json, preflight, serviceClient } from "../_shared/helpers.ts";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

const SIGNED_TTL = 3600; // signed URL sống 1 giờ

// Ký signed URL cho 1 media row (bucket private). Quyền đã được RLS xác nhận trước đó.
async function signItem(admin: SupabaseClient, r: Record<string, unknown>) {
  const path = r.storage_path as string;
  const type = r.type as string;
  const thumbPath = r.thumbnail_path as string | undefined;

  const sign = async (p: string, transform?: Record<string, unknown>) => {
    const { data } = await admin.storage
      .from("trip-media")
      .createSignedUrl(p, SIGNED_TTL, transform ? { transform } : undefined);
    return data?.signedUrl ?? null;
  };

  const publicUrl = path ? await sign(path) : null;
  let thumbnailUrl: string | null;
  if (type === "image" && path) {
    thumbnailUrl = await sign(path, { width: 800, quality: 75, resize: "contain" });
  } else if (thumbPath) {
    thumbnailUrl = await sign(thumbPath);
  } else {
    thumbnailUrl = publicUrl;
  }
  return { ...r, publicUrl, thumbnailUrl };
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

      // RLS đã đảm bảo user chỉ thấy media của trip mình (owner/member).
      // Ký signed URL bằng service role cho đúng các row đó.
      const admin = serviceClient();
      const items = await Promise.all(
        (data ?? []).map((r: Record<string, unknown>) => signItem(admin, r)),
      );
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
