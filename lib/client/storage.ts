"use client";

import { useCallback, useSyncExternalStore } from "react";

// ─── READING A DRAFT OUT OF LOCAL STORAGE ─────────────────────────────────────
// The exam papers restore an in-progress answer draft from localStorage when they
// mount, and every implementation of that was an effect calling setState
// synchronously, which the React Compiler lint rule rightly rejects: it renders
// once with an empty paper, then again with the candidate's own answers, and the
// two renders are guaranteed to disagree about the DOM.
//
// The three ways to do this and why two of them are wrong here:
//
//   useState(() => localStorage.getItem(key))   WRONG. Runs during render, on the
//     server too, where localStorage does not exist — and even guarded, the
//     server would still render an empty paper, so the client's first render
//     (with answers) would not match the HTML React is hydrating. That mismatch
//     is a hydration error, not a warning.
//
//   useEffect(() => setState(read()), [])       WRONG, and this is what the
//     codebase had. A second render pass, and the candidate sees their own
//     answers appear a frame late — on a paper with a running clock, that is a
//     flicker of "everything I typed is gone" right at the moment they start.
//
//   useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)  CORRECT.
//     localStorage genuinely is an external mutable store, and this hook exists
//     for exactly that. getServerSnapshot answers null during SSR *and*
//     hydration, so the markup matches; React then re-renders with the real
//     value immediately after hydration, in the same commit, with no effect and
//     no visible flash.
//
// The subscribe callback is not dead weight: it is what makes a draft restored
// into one tab get picked up if another tab replaces it. On an exam machine that
// is rare, but on a shared family laptop running two tabs it is the difference
// between "my answers" and "the answers I remember typing".

/** Stand-in unsubscribe for when there is no key or no window to listen to. */
const EMPTY = function noop(): void {};

/**
 * Subscribe to a localStorage key, returning its current string value.
 *
 * Returns null when `key` is null, when there is nothing stored, or on the server.
 */
export function useStoredValue(key: string | null): string | null {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!key || typeof window === "undefined") return EMPTY;
      // The `storage` event fires in OTHER tabs, not this one. It is still worth
      // having: it is the only way a value can change underneath us without this
      // tab writing it.
      window.addEventListener("storage", onChange);
      return () => window.removeEventListener("storage", onChange);
    },
    [key],
  );

  const getSnapshot = useCallback(() => {
    if (!key || typeof window === "undefined") return null;
    try {
      return window.localStorage.getItem(key);
    } catch {
      // Safari in private mode, and any browser with site data blocked, throws
      // on access rather than returning null. A candidate on a locked-down
      // managed device should still be able to sit the paper.
      return null;
    }
  }, [key]);

  const getServerSnapshot = useCallback(() => null, []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Parse a stored draft, or return null.
 *
 * Separate from the read because the value is attacker-adjacent: it is
 * whatever happens to be in this browser's storage under this key, which on a
 * shared machine may be a previous candidate's, or a hand-edited object, or the
 * literal string "null". `JSON.parse` of any of those either throws or yields
 * something that is not the shape the caller expects, and a draft is the one
 * place where quietly substituting a default is worse than starting empty.
 */
export function useStoredJson<T>(key: string | null): T | null {
  const raw = useStoredValue(key);
  return parseStoredJson<T>(raw);
}

function parseStoredJson<T>(raw: string | null): T | null {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
