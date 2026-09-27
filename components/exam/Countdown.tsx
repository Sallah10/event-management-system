"use client";

import { useEffect, useRef, useState } from "react";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";

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
      <div className="flex items-center gap-2 text-small text-ink-soft">
        <Clock aria-hidden className="size-3.5" />
        <span className="sr-only">{label}:</span>
        <span
          data-numeric
          className={cn(
            "font-mono tabular-nums",
            urgent ? "font-semibold text-caution" : "text-ink"
          )}
        >
          {format(remaining)}
        </span>
      </div>
    );
  }

  // A pill is correct here: this genuinely is a chip, and it is the only place
  // in the exam UI where the shape is used. The digits are monospaced and
  // tabular so the clock does not reflow as it counts.
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-pill border px-3.5 py-1.5 font-mono text-small font-medium tabular-nums transition-colors duration-[var(--duration-quick)]",
        urgent
          ? "border-caution/45 bg-caution/12 text-caution"
          : "border-line-strong bg-surface text-ink"
      )}
      role="timer"
      aria-live={urgent ? "assertive" : "off"}
    >
      <Clock aria-hidden className="size-3.5" />
      <span className="sr-only">{label}:</span>
      <span>{format(remaining)}</span>
    </div>
  );
}
