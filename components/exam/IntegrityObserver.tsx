"use client";

import { useEffect, useRef } from "react";
import { getDeviceKey } from "@/lib/client/device";

// ─── PROCTORING, HONESTLY ──────────────────────────────────────────────────────
// This replaces ~250 lines that were duplicated across the exam and theory pages,
// and it deletes three things that were actively harmful:
//
// 1. `if (window.innerWidth < 800) flagAction("split screen")`.
//    Window width is not split-screen detection. A phone in portrait is 390px
//    wide. So every candidate on a phone was auto-flagged as running two apps
//    side by side, thirty seconds after opening the paper, and told so by a toast
//    that said "SECURITY". A false accusation, delivered as a system fact.
//
// 2. `alert("Tab switching is strictly prohibited")` on every blur.
//    `blur` fires when you click a non-focusable area, when an OS notification
//    takes focus, when the browser devtools or a password manager steals focus,
//    and on several mobile browsers when the candidate switches to their camera
//    to photograph their ticket. A blocking native dialog mid-exam is a usability
//    failure, and it was the third separate warning system saying the same thing.
//
// 3. `localStorage.clear()` + "DISQUALIFIED" on flag count >= 3.
//    The server never disqualified anyone for tab switching - it recorded a
//    count. So the client destroyed the local session and showed the word
//    DISQUALIFIED while the candidate's database row was untouched and still
//    open. Telling someone they are disqualified, when nothing has been decided,
//    is the one thing an assessment must never do. Integrity review is a human
//    decision (see the admissions queue); the client is a witness, not a judge.
//
// What is left is the part that is actually true: we count the moment the paper
// goes out of focus and we report it to the server, where it is stored, read by
// staff, and weighed by a person. Losing focus is not a crime. Having your
// focus-losses on record is the point.
//
// The window.blur handler is deliberately not implemented. visibilitychange is
// the reliable signal: it does not fire for a devtools window or an OS toast.

interface IntegrityObserverProps {
  /** Where to report an observation. */
  endpoint?: string;
  onObservation?: (kind: string) => void;
}

export default function IntegrityObserver({
  endpoint = "/api/assessment/flag",
  onObservation,
}: IntegrityObserverProps) {
  const sent = useRef(new Set<string>());
  const deviceKey = useRef<string | null>(null);

  useEffect(() => {
    deviceKey.current = getDeviceKey();

    const report = async (kind: string) => {
      // One report per kind per mount. A candidate who alt-tabs thirty times in
      // a row is one person who left, not thirty separate incidents - and a
      // burst of thirty POSTs is a way to flood our own rate limiter.
      if (sent.current.has(kind)) return;
      sent.current.add(kind);

      onObservation?.(kind);

      try {
        await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(deviceKey.current ? { "x-device-key": deviceKey.current } : {}),
          },
          body: JSON.stringify({ reason: kind }),
          keepalive: true,
        });
      } catch {
        // Telemetry that fails to send must never interrupt the exam. The
        // candidate is not responsible for our network, and a failed report is
        // not evidence of anything.
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") void report("Tab or window hidden");
    };

    document.addEventListener("visibilitychange", onVisibility);

    // Pagehide catches the tab being closed or the device being powered off -
    // the two cases where visibilitychange has already fired, or won't get the
    // chance to. keepalive on the fetch above is what makes it land.
    const onPageHide = () => void report("Paper closed or unloaded");
    window.addEventListener("pagehide", onPageHide);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [endpoint, onObservation]);

  return null;
}
