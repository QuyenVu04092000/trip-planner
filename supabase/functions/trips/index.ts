import { authenticate, json, preflight } from "../_shared/helpers.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();

  const auth = await authenticate(req);
  if (!auth) return json({ error: "Unauthorized" }, 401);
  const { sb, userId, userEmail } = auth;

  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  try {
    // ── GET /trips ─────────────────────────────────────────────────────────────
    if (req.method === "GET") {
      const { data: own, error: e1 } = await sb
        .from("trips").select("*").eq("user_id", userId)
        .order("created_at", { ascending: false });
      if (e1) return json({ error: e1.message }, 400);

      const { data: memberRows } = await sb
        .from("trip_members").select("trip_id")
        .eq("user_id", userId).eq("role", "member");

      const sharedIds = (memberRows ?? []).map((r: { trip_id: string }) => r.trip_id);
      let shared: Record<string, unknown>[] = [];
      if (sharedIds.length > 0) {
        const { data } = await sb.from("trips").select("*").in("id", sharedIds);
        shared = data ?? [];
      }

      const merged = new Map<string, Record<string, unknown>>();
      for (const t of [...(own ?? []), ...shared]) merged.set(t.id as string, t);
      const result = [...merged.values()].sort(
        (a, b) =>
          new Date(b.created_at as string).getTime() -
          new Date(a.created_at as string).getTime(),
      );
      return json(result);
    }

    // ── POST /trips ────────────────────────────────────────────────────────────
    if (req.method === "POST") {
      const body = await req.json();
      const { error } = await sb.from("trips").insert({ ...body, user_id: userId });
      if (error) return json({ error: error.message }, 400);
      await sb.from("trip_members").insert({
        id: `mem_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        trip_id: body.id,
        user_id: userId,
        user_email: userEmail,
        role: "owner",
      });
      return json({ ok: true }, 201);
    }

    // ── PUT /trips?id= ────────────────────────────────────────────────────────
    if (req.method === "PUT") {
      if (!id) return json({ error: "Missing id" }, 400);
      const body = await req.json();
      const { error } = await sb.from("trips").update({ ...body, user_id: userId }).eq("id", id);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    // ── DELETE /trips?id= ────────────────────────────────────────────────────
    if (req.method === "DELETE") {
      if (!id) return json({ error: "Missing id" }, 400);
      const { data: mediaRows } = await sb
        .from("media_items").select("storage_path, thumbnail_path").eq("trip_id", id);
      if (mediaRows?.length) {
        const paths: string[] = [];
        for (const r of mediaRows as { storage_path: string; thumbnail_path?: string }[]) {
          if (r.storage_path) paths.push(r.storage_path);
          if (r.thumbnail_path) paths.push(r.thumbnail_path);
        }
        if (paths.length) await sb.storage.from("trip-media").remove(paths);
      }
      const { error } = await sb.from("trips").delete().eq("id", id);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    return json({ error: "Method not allowed" }, 405);
  } catch (err) {
    console.error("[trips]", err);
    return json({ error: String(err) }, 500);
  }
});
