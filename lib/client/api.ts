"use client";

import { getDeviceKey } from "@/lib/client/device";

// ─── API CLIENT ───────────────────────────────────────────────────────────────
// One place where fetch is configured, so four things stop being per-file guesswork:
//
//  1. `credentials: "same-origin"`. The session lives in an httpOnly cookie, so
//     it is not sent unless this is set. A missing credentials option is the
//     single most common reason a rewritten API looks like it "randomly" 401s.
//  2. The `x-device-key` header, on every call. It used to be sent by one page
//     and not the others, which is how the server ended up comparing a header
//     against a session that hadn't been given one.
//  3. The response envelope. Every route answers `{ success, error, message, data }`
//     and this unwraps it, so a page can say `result.data.rank` instead of
//     guessing which level a field landed on.
//  4. Network failures become a typed result instead of an unhandled rejection.

export interface ApiOk<T> {
  ok: true;
  data: T;
  status: number;
}

export interface ApiErr {
  ok: false;
  /** Machine-readable code from the server, or "NETWORK" / "BAD_RESPONSE". */
  code: string;
  message: string;
  /** Extra operator-facing context, e.g. who a duplicate ticket belongs to. */
  details?: string;
  status: number;
  /** Set when the server told us where to send the candidate next. */
  redirect?: string;
}

export type ApiResult<T> = ApiOk<T> | ApiErr;

export async function apiFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<ApiResult<T>> {
  const deviceKey = getDeviceKey();

  const headers: Record<string, string> = {
    ...(init.body ? { "Content-Type": "application/json" } : {}),
    ...(deviceKey ? { "x-device-key": deviceKey } : {}),
    ...((init.headers as Record<string, string>) ?? {}),
  };

  try {
    const response = await fetch(path, {
      ...init,
      headers,
      credentials: "same-origin",
      cache: "no-store",
    });

    let payload: Record<string, unknown>;
    try {
      payload = (await response.json()) as Record<string, unknown>;
    } catch {
      // A route that answered with HTML — a 500 page, a proxy error, a timeout.
      return {
        ok: false,
        code: "BAD_RESPONSE",
        message: "The server sent an unexpected response. Try again.",
        status: response.status,
      };
    }

    if (!response.ok || payload.success === false) {
      return {
        ok: false,
        code: String(payload.error ?? "UNKNOWN"),
        message: String(payload.message ?? "Something went wrong. Please try again."),
        details: typeof payload.details === "string" ? payload.details : undefined,
        status: response.status,
        redirect: typeof payload.redirect === "string" ? payload.redirect : undefined,
      };
    }

    return {
      ok: true,
      // Routes that predate the envelope put their fields at the top level.
      // Unwrap `data` when it's there, otherwise hand back the whole object.
      data: (payload.data ?? payload) as T,
      status: response.status,
    };
  } catch {
    return {
      ok: false,
      code: "NETWORK",
      message: "Connection problem. Check your network and try again.",
      status: 0,
    };
  }
}
