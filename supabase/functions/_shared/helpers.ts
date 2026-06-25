import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

export const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
export const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

export function preflight(): Response {
  return new Response(null, { headers: cors });
}

// Extract the user's JWT from Authorization header, create a Supabase client
// acting AS that user so RLS policies still scope every query correctly.
export async function authenticate(
  req: Request,
): Promise<{ sb: SupabaseClient; userId: string; userEmail: string } | null> {
  const token = (req.headers.get("Authorization") ?? "")
    .replace("Bearer ", "")
    .trim();
  if (!token) return null;

  const sb = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data } = await sb.auth.getUser(token);
  if (!data.user) return null;
  return { sb, userId: data.user.id, userEmail: data.user.email ?? "" };
}
