import { store } from './store';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Server calls made from the main process (library setup and indexing). */
export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = store.getToken();
  if (!token) throw new ApiError(401, 'Not signed in');
  const res = await fetch(store.get('serverUrl') + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body !== undefined && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export interface Me {
  id: string;
  name: string;
  role: 'ADMIN' | 'MANAGER' | 'CREATOR';
}
