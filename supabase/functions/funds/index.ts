import { authenticate, json, preflight } from "../_shared/helpers.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();

  const auth = await authenticate(req);
  if (!auth) return json({ error: "Unauthorized" }, 401);
  const { sb } = auth;

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const tripId = url.searchParams.get("tripId");
  const resource = url.searchParams.get("resource"); // "payments"

  try {
    // GET /funds?tripId=  OR  GET /funds?tripId=&resource=payments
    if (req.method === "GET") {
      if (!tripId) return json({ error: "Missing tripId" }, 400);
      if (resource === "payments") {
        const { data, error } = await sb
          .from("trip_fund_payments").select("*").eq("trip_id", tripId);
        if (error) return json({ error: error.message }, 400);
        return json(data ?? []);
      }
      const { data, error } = await sb
        .from("trip_funds").select("*").eq("trip_id", tripId)
        .order("created_at", { ascending: true });
      if (error) return json({ error: error.message }, 400);
      return json(data ?? []);
    }

    // POST /funds  — creates fund + initial payment rows
    if (req.method === "POST") {
      const { fund, payments } = await req.json();
      const { error: e1 } = await sb.from("trip_funds").insert(fund);
      if (e1) return json({ error: e1.message }, 400);
      if (payments?.length) {
        const { error: e2 } = await sb.from("trip_fund_payments").insert(payments);
        if (e2) return json({ error: e2.message }, 400);
      }
      return json({ ok: true }, 201);
    }

    // PATCH /funds?id=  — toggle payment paid/unpaid
    if (req.method === "PATCH") {
      if (!id) return json({ error: "Missing id" }, 400);
      const { paid } = await req.json();
      const { error } = await sb
        .from("trip_fund_payments")
        .update({ paid, paid_at: paid ? new Date().toISOString() : null })
        .eq("id", id);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    // DELETE /funds?id=
    if (req.method === "DELETE") {
      if (!id) return json({ error: "Missing id" }, 400);
      const { error } = await sb.from("trip_funds").delete().eq("id", id);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    return json({ error: "Method not allowed" }, 405);
  } catch (err) {
    console.error("[funds]", err);
    return json({ error: String(err) }, 500);
  }
});
