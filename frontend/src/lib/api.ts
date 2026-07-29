import { ApiErrorBody } from './types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * Thrown for any non-2xx response. `message` is always human-readable — the
 * backend guarantees its envelope shape — so UI code can render err.message
 * directly and branch on `code`/`status` for behavior.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: string[];

  constructor(status: number, body: Partial<ApiErrorBody> | undefined) {
    super(body?.message ?? 'Something went wrong. Please try again.');
    this.name = 'ApiError';
    this.status = status;
    this.code = body?.code ?? 'UNKNOWN';
    this.details = body?.details ?? [];
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

/**
 * One fetch wrapper for every call. Auth rides on httpOnly cookies
 * (credentials: 'include'); no token ever touches JavaScript.
 *
 * On a 401 it attempts one silent refresh and replays the request once —
 * the access token is 15 minutes, so this is the routine path for any tab
 * left open, not an edge case.
 */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await rawFetch(path, options);

  if (response.status === 401 && !path.startsWith('/auth/')) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      const retried = await rawFetch(path, options);
      return parse<T>(retried);
    }
  }

  return parse<T>(response);
}

function rawFetch(path: string, { method = 'GET', body, signal }: RequestOptions) {
  return fetch(`${API_URL}${path}`, {
    method,
    credentials: 'include',
    signal,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function parse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }

  if (!response.ok) {
    throw new ApiError(response.status, json as Partial<ApiErrorBody>);
  }
  return json as T;
}

/** Deduplicated: concurrent 401s share one refresh attempt. */
let refreshInFlight: Promise<boolean> | null = null;

function tryRefresh(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}
