"use client";

import { useEffect, useRef, useState } from "react";
import { Clock } from "lucide-react";

// ─── SERVER-ISSUED COUNTDOWN ──────────────────────────────────────────────────
// The deadline is a prop, computed on the server from objective_started_at (see
// lib/exam-sitting.ts). This component only subtracts time from it.
//
// That is the entire difference between a real limit and the old one, which did
// `useState(1800)` and incremented down from mount. `endAt` instead of `seconds`:
// a refresh recomputes the same number, because the number was never in the
// browser to begin with.
//
// It ticks against wall-clock time rather than a setInterval decrement, so a
// throttled background tab (iOS suspends timers entirely), a sleeping laptop, or
// a machine that was off for an hour cannot hand the candidate free time. The
// interval is only a nudge to re-read the clock.

interface CountdownProps {
  /** ISO timestamp from the server. */
  endAt: string;
  /** Called once, when the clock hits zero. */
  onExpire?: () => void;
  /** Hide the chip and expose the value to the page instead. */
  variant?: "chip" | "bar";
  label?: string;
}

function format(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export default function Countdown({
  endAt,
  onExpire,
  variant = "chip",
  label = "Time remaining",
}: CountdownProps) {
  const target = new Date(endAt).getTime();
  const [remaining, setRemaining] = useState(() => target - Date.now());
  const expired = useRef(false);

  useEffect(() => {
    expired.current = false;
    const tick = () => {
      const left = target - Date.now();
      setRemaining(left);
      if (left <= 0 && !expired.current) {
        expired.current = true;
        onExpire?.();
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [target, onExpire]);

  // Under five minutes is the only thing worth interrupting a candidate for.
  const urgent = remaining <= 5 * 60_000 && remaining > 0;

  if (variant === "bar") {
    return (
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-ink/60">
        <Clock className="h-3.5 w-3.5" aria-hidden />
        <span className="sr-only">{label}:</span>
        <span className={urgent ? "text-amber-700 tabular-nums" : "tabular-nums"}>
          {format(remaining)}
        </span>
      </div>
    );
  }

  return (
    <div
      className={`flex items-center gap-2 rounded-full border px-4 py-2 font-mono text-sm font-bold tabular-nums ${
        urgent
          ? "border-amber-500 bg-amber-50 text-amber-900"
          : "border-ink/15 bg-ink/5 text-ink"
      }`}
      role="timer"
      aria-live={urgent ? "assertive" : "off"}
    >
      <Clock className="h-4 w-4" aria-hidden />
      <span className="sr-only">{label}:</span>
      <span>{format(remaining)}</span>
    </div>
  );
}
