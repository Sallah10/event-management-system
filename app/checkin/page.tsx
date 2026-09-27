"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { AlertTriangle, Camera, CheckCircle2, Keyboard, Users } from "lucide-react";
import { apiFetch } from "@/lib/client/api";
import { COURSES } from "@/config/course-matrix";
import { BRAND } from "@/config/branding";
import { VENUE_CAPACITY } from "@/config/rules";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Alert, Spinner } from "@/components/ui/display";
import { Page, PageHeader, Stack } from "@/components/ui/shell";

// ─── CHECK-IN DESK ────────────────────────────────────────────────────────────
// The camera + hardware-gun behaviour here was the most valuable part of the
// original, and it is kept: a door queue cannot wait for someone to find the
// right app, and barcode guns behave differently enough per device that a
// keyboard-capture layer earns its keep.
//
// Four things were wrong around it:
//
// 1. THE KEYBOARD HANDLER WAS WRITTEN TWICE. Lines 194-247 and 262-303 of the
//    old file were the same ~50 lines, differing only in what the 500ms timeout
//    did (discard the buffer, or submit it). A `useEffect` assigned the second
//    over the first, so the first version was unreachable — a live edit that
//    looked like a fix and was silently reverted by the line below it. It is one
//    handler now, and it submits on timeout, which is the behaviour that helps a
//    candidate whose gun is slow.
//
// 2. SUCCESS WAS PARSED OUT OF A PROSE STRING.
//    `info.message?.split(": ")[1] || info.message` — the greeting is built as
//    `Welcome, ${name}!` and then taken apart again to recover the name the
//    server already sent in its own field. One copy-edit of that template and
//    the door displays "Welcome," with nothing after it.
//
// 3. `info.course` is a slug. The screen showed the candidate their raw
//    registration slug — "aws-certified-cloud-practitioner-13" — on the one
//    display a human reads out loud.
//
// 4. Raw `fetch` for an authenticated endpoint, and `console.log` of every
//    single scan, which put every attendee's ticket in the browser console of a
//    shared venue laptop.
//
// A door has one job and it is unforgiving: scan, get an unambiguous answer,
// scan again. Every state below is a decision the person on the desk has to
// make, and each one says what to do next.
//
// PRESENTATION ONLY. The old frame was a white rounded-3xl card on a centred
// paper field, with a dark masthead band, a rounded-full mode pill, a pulsing
// amber dot and three hand-rolled result cards in Tailwind green/red. It is now
// the shared page frame: one hairline, one h1 from `PageHeader`, `Button` for
// the mode switch, and `Alert` for the three outcomes. The two states that used
// to be visually loudest — accepted and denied — now differ by tone and wording
// rather than by three separate sets of palette colours, and the candidate's
// name is set in the display serif because it is the one thing on the screen
// read aloud.

interface CheckinOk {
  name: string;
  courseSlug: string | null;
  venueCount: number;
  venueCapacity: number;
}

type DeskState =
  | { kind: "IDLE" }
  | { kind: "SCANNING" }
  | { kind: "OK"; name: string; course: string; count: number; capacity: number }
  | { kind: "DENIED"; headline: string; detail: string; tone: "warn" | "stop" };

const courseLabel = (slug: string | null): string => {
  if (!slug) return "Open admission";
  return COURSES.find((course) => course.slug === slug)?.displayName ?? slug;
};

/** Gun buffer timeout. Slow hubs on older USB scanners need the room. */
const GUN_IDLE_MS = 500;

export default function CheckinPage() {
  const [state, setState] = useState<DeskState>({ kind: "IDLE" });
  const [inputMode, setInputMode] = useState<"camera" | "gun">("camera");
  const [scanBuffer, setScanBuffer] = useState("");

  const scanner = useRef<Html5Qrcode | null>(null);
  const hardwareInput = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const lastScan = useRef("");
  const buffer = useRef("");
  const bufferTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modeRef = useRef<"camera" | "gun">("camera");
  const verifyRef = useRef<(ticket: string) => void>(() => {});

  useEffect(() => {
    modeRef.current = inputMode;
  }, [inputMode]);

  const stopScanning = useCallback(() => {
    // pause() and resume() are synchronous in html5-qrcode — only start() and
    // stop() return promises. The original code .catch()ed all four.
    if (scanner.current?.isScanning) scanner.current.pause();
  }, []);

  const resume = useCallback(() => {
    if (modeRef.current === "camera" && scanner.current?.isScanning) {
      scanner.current.resume();
    }
    hardwareInput.current?.focus();
  }, []);

  /** Back to neutral, ready for the next person in the queue. */
  const reset = useCallback(
    (delay: number) => {
      setTimeout(() => {
        setState({ kind: "IDLE" });
        busy.current = false;
        lastScan.current = "";
        resume();
      }, delay);
    },
    [resume],
  );

  const verify = useCallback(
    async (raw: string) => {
      const ticket = raw.trim().toUpperCase();
      if (ticket.length < 3) return;
      // One scan, one request. A gun fires the same code repeatedly while the
      // first request is in flight, and a queue of duplicate requests is a queue
      // of duplicate "already checked in" screens.
      if (busy.current || ticket === lastScan.current) return;

      lastScan.current = ticket;
      busy.current = true;
      setState({ kind: "SCANNING" });
      stopScanning();

      const result = await apiFetch<CheckinOk>("/api/check-in", {
        method: "POST",
        body: JSON.stringify({ barcodeId: ticket }),
      });

      navigator.vibrate?.(result.ok ? [200, 100, 200] : [100, 50, 100, 50, 100]);

      if (result.ok) {
        setState({
          kind: "OK",
          name: result.data.name,
          course: courseLabel(result.data.courseSlug),
          count: result.data.venueCount,
          capacity: result.data.venueCapacity,
        });
        reset(4000);
        return;
      }

      // "Already in" is a routine occurrence at a door; a full venue or an
      // unknown ticket means a human has to step in. The desk needs to tell those
      // apart at a glance, so the tone differs.
      const tone = result.code === "ALREADY_CHECKED_IN" ? "warn" : "stop";
      setState({
        kind: "DENIED",
        headline: result.message,
        detail: result.details ?? result.message,
        tone,
      });
      reset(result.code === "NETWORK" ? 5000 : 4000);
    },
    [reset, stopScanning],
  );

  verifyRef.current = verify;

  // ─── CAMERA ────────────────────────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    // The scanner needs its mount point in the DOM. In gun mode that div is not
    // rendered, so wait for it rather than assuming it is there.
    let attempts = 0;
    while (!document.getElementById("scanner") && attempts < 20) {
      attempts += 1;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!document.getElementById("scanner")) {
      setInputMode("gun");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setInputMode("gun");
      return;
    }

    try {
      if (!scanner.current) scanner.current = new Html5Qrcode("scanner");
      if (scanner.current.isScanning) await scanner.current.stop();

      await scanner.current.start(
        { facingMode: "environment" },
        { fps: 20, qrbox: { width: 260, height: 260 }, aspectRatio: 1 },
        (decoded) => {
          if (!busy.current) void verify(decoded);
        },
        () => {},
      );
    } catch {
      // No camera permission, no camera, or a secure-context problem. The gun and
      // the keyboard still work, so this is a downgrade rather than a dead page.
      setInputMode("gun");
    }
  }, [verify]);

  // ─── GUN / KEYBOARD CAPTURE ────────────────────────────────────────────────
  // One handler. A hardware scanner types a code and presses Enter, so the only
  // thing this has to do is accumulate printable keys, swallow the modifiers and
  // function keys that arrive as noise, and submit on Enter — or on the idle
  // timeout, for the guns that never send one.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (["Shift", "Tab", "Escape", "F5"].includes(event.key)) return;
      if (event.key.length === 1 && /^F\d+$/.test(event.key)) return;

      if (busy.current) {
        // Swallow the rest of a scan we have already accepted, or the tail of it
        // types itself into the page behind the result card.
        event.preventDefault();
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        if (bufferTimer.current) clearTimeout(bufferTimer.current);
        const code = buffer.current.trim();
        buffer.current = "";
        setScanBuffer("");
        if (hardwareInput.current) hardwareInput.current.value = "";
        if (code.length > 3) verifyRef.current(code);
        return;
      }

      if (event.key.length === 1) {
        event.preventDefault();
        buffer.current += event.key;
        setScanBuffer(buffer.current);
        if (hardwareInput.current) hardwareInput.current.value = buffer.current;

        if (bufferTimer.current) clearTimeout(bufferTimer.current);
        bufferTimer.current = setTimeout(() => {
          // Fire on idle as well as Enter. Some scanners on some hubs never send
          // Enter, and a door that silently swallows codes is worse than one that
          // submits early.
          const code = buffer.current.trim();
          if (code.length > 3) verifyRef.current(code);
          buffer.current = "";
          setScanBuffer("");
          if (hardwareInput.current) hardwareInput.current.value = "";
        }, GUN_IDLE_MS);
      }
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    const focus = () => {
      if (!busy.current) hardwareInput.current?.focus();
    };
    document.addEventListener("click", focus);
    const start = setTimeout(focus, 300);
    const camera = setTimeout(() => void startCamera(), 200);

    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      document.removeEventListener("click", focus);
      clearTimeout(start);
      clearTimeout(camera);
      if (bufferTimer.current) clearTimeout(bufferTimer.current);
      if (scanner.current?.isScanning) {
        scanner.current.stop().catch(() => {});
      }
    };
    // Mount only. startCamera is stable enough and re-running it would fight the
    // operator toggling modes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleMode = async () => {
    if (inputMode === "camera") {
      if (scanner.current?.isScanning) {
        await scanner.current.stop().catch(() => {});
      }
      setInputMode("gun");
    } else {
      setInputMode("camera");
      setTimeout(() => void startCamera(), 150);
    }
    setTimeout(() => hardwareInput.current?.focus(), 100);
  };

  return (
    <Page
      width="form"
      className="flex min-h-dvh flex-col justify-center gap-6 py-10 sm:py-14"
    >
      {/* Focus sink for the gun. Invisible but real: without a focused element
          the browser window may not be the keyboard target at a kiosk.
          Deliberately outside the accessibility tree and the tab order — nothing
          fills it in, the gun types into it — so it gets no <label>. If that ever
          changes, it needs a real one like every other control. */}
      <input
        ref={hardwareInput}
        type="text"
        className="absolute h-0 w-0 opacity-0"
        aria-hidden
        tabIndex={-1}
        readOnly
      />

      <PageHeader
        eyebrow={BRAND.shortName}
        title="Entrance check-in"
        actions={
          <Button type="button" variant="outline" size="lg" onClick={toggleMode}>
            {inputMode === "camera" ? (
              <>
                <Keyboard aria-hidden />
                Use a barcode gun
              </>
            ) : (
              <>
                <Camera aria-hidden />
                Use the camera
              </>
            )}
          </Button>
        }
      >
        <p className="flex items-center gap-2 text-small text-ink-soft">
          {inputMode === "camera" ? (
            <>
              <Camera aria-hidden className="size-4 text-ink-faint" />
              Camera
            </>
          ) : (
            <>
              <Keyboard aria-hidden className="size-4 text-ink-faint" />
              Barcode gun
            </>
          )}
          <span aria-hidden className="text-ink-faint">
            ·
          </span>
          <Users aria-hidden className="size-4 text-ink-faint" />
          <span data-numeric className="tabular-nums">
            cap {VENUE_CAPACITY.toLocaleString()}
          </span>
        </p>
      </PageHeader>

      <Stack gap="md">
        {/* Always mounted in camera mode so html5-qrcode has a node to attach
            to. An unmounted-then-mounted div is why the original polled for it
            20 times. */}
        <div className={cn(inputMode === "camera" ? "block" : "hidden")}>
          <div
            id="scanner"
            className="aspect-square w-full overflow-hidden rounded-md bg-ink"
          />
        </div>

        {inputMode === "gun" && (
          <div className="grid aspect-[3/2] place-items-center rounded-md bg-ink p-5">
            <div className="text-center">
              <Keyboard aria-hidden className="mx-auto size-10 text-amber" />
              <p className="mt-3 text-small font-medium text-paper">
                Scan or type a code
              </p>
              {scanBuffer && (
                <p className="mt-2 break-all font-mono text-small text-amber">
                  {scanBuffer}
                </p>
              )}
            </div>
          </div>
        )}

        <div className="grid min-h-32 place-items-center">
          {state.kind === "IDLE" && (
            <p className="flex items-center gap-2 text-small text-ink-soft">
              <span aria-hidden className="size-1.5 rounded-pill bg-amber" />
              Ready for the next ticket
            </p>
          )}

          {state.kind === "SCANNING" && (
            <div className="flex items-center justify-center gap-2 text-small text-ink-soft">
              <Spinner label="Checking" />
              <span aria-hidden>Checking the ticket</span>
            </div>
          )}

          {state.kind === "OK" && (
            /* The name goes in the body rather than the `title` slot: it is the
               one thing on this screen read aloud, so it is set in the display
               serif, and the alert's own title is typed for body copy. */
            <Alert
              tone="positive"
              icon={CheckCircle2}
              role="status"
              className="w-full p-6"
            >
              <p className="font-display text-h3 leading-tight text-balance text-ink">
                {state.name}
              </p>
              <p className="mt-1.5">{state.course}</p>
              <p
                data-numeric
                className="mt-3 border-t border-line pt-3 text-small font-medium tabular-nums text-ink"
              >
                In · {state.count.toLocaleString()} /{" "}
                {state.capacity.toLocaleString()}
              </p>
            </Alert>
          )}

          {/* `role="status"` is kept on the refusal as it was, including for the
              "stop" case: at a door the operator is already watching this
              screen, so a polite announcement is the right register even for a
              hard refusal. */}
          {state.kind === "DENIED" && (
            <Alert
              tone={state.tone === "warn" ? "caution" : "critical"}
              icon={AlertTriangle}
              role="status"
              className="w-full"
              title={state.headline}
            >
              {state.detail}
            </Alert>
          )}
        </div>
      </Stack>
    </Page>
  );
}
