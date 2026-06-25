import { authenticate, json, preflight } from "../_shared/helpers.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();

  const auth = await authenticate(req);
  if (!auth) return json({ error: "Unauthorized" }, 401);
  const { sb } = auth;

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const tripId = url.searchParams.get("tripId");

  try {
    // GET /activities?tripId=
    if (req.method === "GET") {
      if (!tripId) return json({ error: "Missing tripId" }, 400);
      const { data, error } = await sb
        .from("activities").select("*").eq("trip_id", tripId)
        .order("position").order("created_at");
      if (error) return json({ error: error.message }, 400);
      return json(data ?? []);
    }

    // POST /activities
    if (req.method === "POST") {
      const body = await req.json();
      const { data, error } = await sb.from("activities").insert(body).select().single();
      if (error) return json({ error: error.message }, 400);
      return json(data, 201);
    }

    // PUT /activities?id=
    if (req.method === "PUT") {
      if (!id) return json({ error: "Missing id" }, 400);
      const body = await req.json();
      const { error } = await sb.from("activities").update(body).eq("id", id);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    // DELETE /activities?id=
    if (req.method === "DELETE") {
      if (!id) return json({ error: "Missing id" }, 400);
      const { error } = await sb.from("activities").delete().eq("id", id);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    return json({ error: "Method not allowed" }, 405);
  } catch (err) {
    console.error("[activities]", err);
    return json({ error: String(err) }, 500);
  }
});
