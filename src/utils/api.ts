import { supabase } from './supabase';

const BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

async function getToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated');
  return session.access_token;
}

async function request<T>(
  path: string,
  method: string,
  body?: unknown,
  params?: Record<string, string>,
): Promise<T> {
  const token = await getToken();
  const url = new URL(`${BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, v);
    }
  }
  const res = await fetch(url.toString(), {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  get:    <T>(path: string, params?: Record<string, string>) =>
    request<T>(path, 'GET', undefined, params),
  post:   <T>(path: string, body: unknown, params?: Record<string, string>) =>
    request<T>(path, 'POST', body, params),
  put:    <T>(path: string, body: unknown, params?: Record<string, string>) =>
    request<T>(path, 'PUT', body, params),
  patch:  <T>(path: string, body: unknown, params?: Record<string, string>) =>
    request<T>(path, 'PATCH', body, params),
  delete: <T>(path: string, params?: Record<string, string>) =>
    request<T>(path, 'DELETE', undefined, params),
};
