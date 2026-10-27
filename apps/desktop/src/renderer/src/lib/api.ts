import { QueryClient } from '@tanstack/react-query';
import { useSession } from './session';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: true } },
});

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { serverUrl, token } = useSession.getState();
  const isForm = body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(serverUrl + path, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, `Can't reach the Mantis server at ${serverUrl}`);
  }
  if (res.status === 401 && token) {
    await useSession.getState().signOut();
  }
  const type = res.headers.get('content-type') ?? '';
  const data = type.includes('json') ? await res.json() : await res.blob();
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T>(p: string, b?: unknown) => request<T>('POST', p, b ?? {}),
  put: <T>(p: string, b?: unknown) => request<T>('PUT', p, b ?? {}),
  patch: <T>(p: string, b?: unknown) => request<T>('PATCH', p, b ?? {}),
  del: <T>(p: string) => request<T>('DELETE', p),
};

/** URL for a stored file (thumbnail, preview, generated image) usable in <img src>. */
export function fileUrl(key: string | null | undefined): string | undefined {
  if (!key) return undefined;
  const { serverUrl, token } = useSession.getState();
  return `${serverUrl}/files/${key}?token=${encodeURIComponent(token ?? '')}`;
}

/** Downloads an authenticated API response as a file (save dialog). */
export async function download(path: string, fallbackName: string) {
  const { serverUrl, token } = useSession.getState();
  const res = await fetch(serverUrl + path, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Download failed' }));
    throw new ApiError(res.status, err.error);
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
