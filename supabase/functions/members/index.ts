import { authenticate, json, preflight } from "../_shared/helpers.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return preflight();

  const auth = await authenticate(req);
  if (!auth) return json({ error: "Unauthorized" }, 401);
  const { sb, userId, userEmail } = auth;

  const url = new URL(req.url);
  const action = url.searchParams.get("action"); // invite|accept|leave|remove|is-owner
  const tripId = url.searchParams.get("tripId");
  const memberId = url.searchParams.get("memberId");
  const token = url.searchParams.get("token");

  try {
    // GET /members?tripId=          → fetchTripMembers
    // GET /members?action=is-owner&tripId=  → isOwner
    // GET /members?action=invite&token=     → getInviteByToken
    if (req.method === "GET") {
      if (action === "is-owner") {
        if (!tripId) return json({ error: "Missing tripId" }, 400);
        const { data } = await sb.from("trip_members")
          .select("role").eq("trip_id", tripId).eq("user_id", userId).single();
        return json({ isOwner: (data as { role?: string } | null)?.role === "owner" });
      }

      if (action === "invite") {
        if (!token) return json({ error: "Missing token" }, 400);
        const { data, error } = await sb
          .from("trip_invites").select("*").eq("token", token).single();
        if (error || !data) return json(null);
        return json(data);
      }

      // fetchTripMembers
      if (!tripId) return json({ error: "Missing tripId" }, 400);
      const { data: rows, error } = await sb
        .from("trip_members").select("*").eq("trip_id", tripId)
        .order("joined_at", { ascending: true });
      if (error) return json({ error: error.message }, 400);

      const userIds = (rows ?? []).map((r: { user_id: string }) => r.user_id);
      const profileMap: Record<string, string> = {};
      if (userIds.length > 0) {
        const { data: profiles } = await sb
          .from("user_profiles").select("user_id, display_name").in("user_id", userIds);
        for (const p of profiles ?? []) {
          profileMap[(p as { user_id: string; display_name: string }).user_id] =
            (p as { user_id: string; display_name: string }).display_name;
        }
      }

      const members = (rows ?? []).map((r: Record<string, unknown>) => ({
        ...r,
        display_name: profileMap[r.user_id as string] ?? (r.user_email as string).split("@")[0],
      }));
      return json(members);
    }

    // POST /members?action=invite  → createInvite
    // POST /members?action=accept  → acceptInvite
    if (req.method === "POST") {
      if (action === "invite") {
        const { tripId: tid, tripName, tripEmoji } = await req.json();
        const inviteToken = crypto.randomUUID();
        const id = `inv_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        const { error } = await sb.from("trip_invites").insert({
          id, trip_id: tid, token: inviteToken,
          created_by: userId, trip_name: tripName, trip_emoji: tripEmoji,
          owner_email: userEmail, status: "active", expires_at: expiresAt,
        });
        if (error) return json({ error: error.message }, 400);
        return json({ token: inviteToken }, 201);
      }

      if (action === "accept") {
        const { token: invToken } = await req.json();
        const { data: invite, error: ie } = await sb
          .from("trip_invites").select("*").eq("token", invToken).single();
        if (ie || !invite) return json({ error: "Invalid invite" }, 400);
        if (invite.status !== "active" || new Date(invite.expires_at) < new Date()) {
          return json({ error: "Invite expired" }, 400);
        }
        const { error: rpcError } = await sb.rpc("accept_trip_invite", {
          p_trip_id: invite.trip_id,
          p_user_id: userId,
          p_user_email: userEmail,
        });
        if (rpcError) return json({ error: rpcError.message }, 400);
        return json({ tripId: invite.trip_id });
      }

      return json({ error: "Unknown action" }, 400);
    }

    // DELETE /members?action=leave&tripId=    → leaveTrip
    // DELETE /members?action=remove&tripId=&memberId=  → removeMember
    if (req.method === "DELETE") {
      if (action === "leave") {
        if (!tripId) return json({ error: "Missing tripId" }, 400);
        const { error } = await sb.from("trip_members")
          .delete().eq("trip_id", tripId).eq("user_id", userId).eq("role", "member");
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true });
      }

      if (action === "remove") {
        if (!tripId || !memberId) return json({ error: "Missing tripId or memberId" }, 400);
        const { error } = await sb.from("trip_members")
          .delete().eq("trip_id", tripId).eq("user_id", memberId).eq("role", "member");
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true });
      }

      return json({ error: "Unknown action" }, 400);
    }

    return json({ error: "Method not allowed" }, 405);
  } catch (err) {
    console.error("[members]", err);
    return json({ error: String(err) }, 500);
  }
});
