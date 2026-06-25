import { authenticate, json, preflight } from "../_shared/helpers.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();

  const auth = await authenticate(req);
  if (!auth) return json({ error: "Unauthorized" }, 401);
  const { sb, userId } = auth;

  try {
    // GET /profile
    if (req.method === "GET") {
      const { data } = await sb
        .from("user_profiles").select("*").eq("user_id", userId).maybeSingle();
      return json(data ?? null);
    }

    // PUT /profile
    if (req.method === "PUT") {
      const { displayName } = await req.json();
      const { error } = await sb.from("user_profiles").upsert(
        { user_id: userId, display_name: displayName?.trim(), updated_at: new Date().toISOString() },
        { onConflict: "user_id" },
      );
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    return json({ error: "Method not allowed" }, 405);
  } catch (err) {
    console.error("[profile]", err);
    return json({ error: String(err) }, 500);
  }
});
