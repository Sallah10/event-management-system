"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { Html5Qrcode } from "html5-qrcode";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  QrCode,
  ShieldCheck,
  AlertTriangle,
  Loader2,
  Camera,
  Keyboard,
  CheckCircle2,
  ScanLine,
} from "lucide-react";

export default function CheckinPage() {
  const [status, setStatus] = useState<
    "IDLE" | "SCANNING" | "SUCCESS" | "ERROR"
  >("IDLE");
  const [info, setInfo] = useState<any>(null);
  const [error, setError] = useState("");
  const [inputMode, setInputMode] = useState<"camera" | "gun">("camera");
  const [scanBuffer, setScanBuffer] = useState("");
  const [cameraReady, setCameraReady] = useState(false);

  const html5QrCode = useRef<Html5Qrcode | null>(null);
  const hardwareInputRef = useRef<HTMLInputElement>(null);

  // These refs let callbacks always see latest values without re-creating them
  const isProcessing = useRef(false);
  const lastScanRef = useRef<string>("");
  const scanBufferRef = useRef<string>("");
  const scanTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const inputModeRef = useRef<"camera" | "gun">("camera");
  const statusRef = useRef<"IDLE" | "SCANNING" | "SUCCESS" | "ERROR">("IDLE");

  // Keep refs in sync with state
  useEffect(() => {
    inputModeRef.current = inputMode;
  }, [inputMode]);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // ─── RESET AFTER SCAN ────────────────────────────────────────────────────
  const resetAfterDelay = useCallback((delay: number) => {
    setTimeout(() => {
      setStatus("IDLE");
      setInfo(null);
      isProcessing.current = false;
      lastScanRef.current = "";

      if (
        inputModeRef.current === "camera" &&
        html5QrCode.current?.isScanning
      ) {
        try {
          html5QrCode.current.resume();
        } catch (_) {}
      }

      if (hardwareInputRef.current) {
        hardwareInputRef.current.value = "";
        hardwareInputRef.current.focus();
      }
    }, delay);
  }, []);

  // ─── UNIFIED VERIFY ───────────────────────────────────────────────────────
  const handleVerify = useCallback(
    async (barcodeId: string) => {
      const cleanId = barcodeId.trim().toUpperCase();

      if (!cleanId || cleanId.length < 3) return;
      if (isProcessing.current) return;
      if (cleanId === lastScanRef.current) return;

      console.log("✅ Verifying:", cleanId);
      lastScanRef.current = cleanId;
      isProcessing.current = true;

      setStatus("SCANNING");
      setError("");

      // Pause camera immediately
      if (
        inputModeRef.current === "camera" &&
        html5QrCode.current?.isScanning
      ) {
        try {
          html5QrCode.current.pause();
        } catch (_) {}
      }

      try {
        const res = await fetch("/api/check-in", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ barcodeId: cleanId }),
        });

        const data = await res.json();
        console.log("API Response:", data);

        if (data.success) {
          setStatus("SUCCESS");
          setInfo(data);
          if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
          resetAfterDelay(3000);
        } else {
          setStatus("ERROR");
          setError(data.message || "Check-in failed");
          if (navigator.vibrate) navigator.vibrate([100, 50, 100, 50, 100]);
          resetAfterDelay(4000);
        }
      } catch (err) {
        console.error("Network error:", err);
        setStatus("ERROR");
        setError("Network error. Try again.");
        resetAfterDelay(4000);
      }
    },
    [resetAfterDelay],
  );

  // ─── CAMERA SCANNER ───────────────────────────────────────────────────────
  // FIX: startCamera is called AFTER the reader div is confirmed in the DOM
  const startCamera = useCallback(async () => {
    // Wait for #reader element to actually exist in the DOM
    let attempts = 0;
    const tryStart = async () => {
      const readerElement = document.getElementById("reader");
      if (!readerElement) {
        attempts++;
        if (attempts < 20) {
          setTimeout(tryStart, 100); // retry every 100ms, up to 2 seconds
        } else {
          console.warn(
            "Camera reader element never appeared, switching to gun mode",
          );
          setInputMode("gun");
        }
        return;
      }

      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setInputMode("gun");
          return;
        }

        if (!html5QrCode.current) {
          html5QrCode.current = new Html5Qrcode("reader");
        }

        if (html5QrCode.current.isScanning) {
          try {
            await html5QrCode.current.stop();
          } catch (_) {}
        }

        await html5QrCode.current.start(
          { facingMode: "environment" },
          { fps: 20, qrbox: { width: 280, height: 280 }, aspectRatio: 1.0 },
          (decodedText) => {
            if (!isProcessing.current) {
              handleVerify(decodedText);
            }
          },
          () => {},
        );

        setCameraReady(true);
        console.log("📷 Camera started successfully");
      } catch (err) {
        console.warn("Camera failed, switching to gun mode:", err);
        setInputMode("gun");
      }
    };

    tryStart();
  }, [handleVerify]);

  // ─── BARCODE GUN HANDLER ─────────────────────────────────────────────────
  // FIX: Stable ref-based handler — never re-created, so the listener is added ONCE
  const handleBarcodeInput = useRef((e: KeyboardEvent) => {
    // Skip modifier-only keys
    if (["Shift", "Control", "Alt", "Meta", "Tab"].includes(e.key)) return;
    if (e.key.startsWith("F")) return;

    // If we're already processing a scan, swallow all input
    if (isProcessing.current) {
      e.preventDefault();
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();

      // Clear any pending timeout
      if (scanTimeoutRef.current) {
        clearTimeout(scanTimeoutRef.current);
        scanTimeoutRef.current = null;
      }

      const barcode = scanBufferRef.current.trim();
      console.log("🔫 Gun Enter — barcode captured:", barcode);

      if (barcode && barcode.length > 3) {
        handleVerifyRef.current(barcode);
      }

      scanBufferRef.current = "";
      setScanBuffer("");
      if (hardwareInputRef.current) hardwareInputRef.current.value = "";
      return;
    }

    if (e.key.length === 1) {
      e.preventDefault();
      scanBufferRef.current += e.key;
      setScanBuffer(scanBufferRef.current);

      if (hardwareInputRef.current) {
        hardwareInputRef.current.value = scanBufferRef.current;
      }

      // FIX: Longer timeout (500ms) — barcode guns can be slow on some USB hubs
      if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
      scanTimeoutRef.current = setTimeout(() => {
        console.log("⏱ Scan timeout, buffer was:", scanBufferRef.current);
        scanBufferRef.current = "";
        setScanBuffer("");
        if (hardwareInputRef.current) hardwareInputRef.current.value = "";
        scanTimeoutRef.current = null;
      }, 500);
    }
  });

  // Keep handleVerify ref up to date
  const handleVerifyRef = useRef(handleVerify);
  useEffect(() => {
    handleVerifyRef.current = handleVerify;
  }, [handleVerify]);

  // Patch the gun handler to always call latest handleVerify
  useEffect(() => {
    handleBarcodeInput.current = (e: KeyboardEvent) => {
      if (["Shift", "Control", "Alt", "Meta", "Tab"].includes(e.key)) return;
      if (e.key.startsWith("F")) return;
      if (isProcessing.current) {
        e.preventDefault();
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        if (scanTimeoutRef.current) {
          clearTimeout(scanTimeoutRef.current);
          scanTimeoutRef.current = null;
        }
        const barcode = scanBufferRef.current.trim();
        console.log("🔫 Barcode gun Enter — value:", `"${barcode}"`);
        if (barcode && barcode.length > 3) {
          handleVerifyRef.current(barcode);
        }
        scanBufferRef.current = "";
        setScanBuffer("");
        if (hardwareInputRef.current) hardwareInputRef.current.value = "";
        return;
      }

      if (e.key.length === 1) {
        e.preventDefault();
        scanBufferRef.current += e.key;
        setScanBuffer(scanBufferRef.current);
        if (hardwareInputRef.current)
          hardwareInputRef.current.value = scanBufferRef.current;

        if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
        scanTimeoutRef.current = setTimeout(() => {
          const barcode = scanBufferRef.current.trim();
          console.log("⏱ Timeout fired, submitting:", barcode);
          if (barcode && barcode.length > 3) {
            handleVerifyRef.current(barcode); // ← submit instead of discard
          }
          scanBufferRef.current = "";
          setScanBuffer("");
          if (hardwareInputRef.current) hardwareInputRef.current.value = "";
          scanTimeoutRef.current = null;
        }, 500);
      }
    };
  }, [handleVerify]);

  // ─── SETUP — runs ONCE ────────────────────────────────────────────────────
  useEffect(() => {
    // FIX: Stable wrapper so the listener reference never changes
    const keydownWrapper = (e: KeyboardEvent) => handleBarcodeInput.current(e);
    window.addEventListener("keydown", keydownWrapper, { capture: true });

    const focusInput = () => {
      if (hardwareInputRef.current && !isProcessing.current) {
        hardwareInputRef.current.focus();
      }
    };
    document.addEventListener("click", focusInput);
    setTimeout(focusInput, 300);

    // FIX: Start camera after a short delay to ensure DOM is rendered
    const cameraTimer = setTimeout(() => {
      startCamera();
    }, 200);

    return () => {
      window.removeEventListener("keydown", keydownWrapper, { capture: true });
      document.removeEventListener("click", focusInput);
      clearTimeout(cameraTimer);
      if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
      if (html5QrCode.current?.isScanning) {
        html5QrCode.current.stop().catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // ← intentionally empty: runs once on mount

  // ─── TOGGLE MODE ─────────────────────────────────────────────────────────
  const toggleMode = async () => {
    if (inputMode === "camera") {
      if (html5QrCode.current?.isScanning) {
        try {
          await html5QrCode.current.stop();
        } catch (_) {}
      }
      setCameraReady(false);
      setInputMode("gun");
    } else {
      setInputMode("camera");
      // Give React time to render #reader before starting camera
      setTimeout(() => startCamera(), 150);
    }
    setTimeout(() => hardwareInputRef.current?.focus(), 100);
  };

  if (process.env.NODE_ENV === "development") {
    (window as any).testCheckin = handleVerify;
  }

  return (
    <div className="min-h-screen bg-[#E6E6FF] flex items-center justify-center p-4 font-sans">
      <Card className="w-full max-w-md border-2 border-[#0000FF] shadow-2xl bg-white overflow-hidden rounded-[40px]">
        {/* Hidden input to capture focus for barcode gun */}
        <input
          ref={hardwareInputRef}
          type="text"
          className="absolute opacity-0 pointer-events-none w-0 h-0"
          autoFocus
          readOnly
        />

        <CardHeader className="bg-[#0000FF] text-white text-center py-8">
          <CardTitle className="text-2xl font-black tracking-tighter flex items-center justify-center gap-2 italic">
            <ShieldCheck className="h-7 w-7 text-[#FFBB00]" /> TS2026 ENTRANCE
          </CardTitle>
          <CardDescription className="text-blue-100 font-bold text-[10px] uppercase tracking-widest mt-1">
            <span className="flex items-center justify-center gap-2">
              <ScanLine className="h-4 w-4" />
              {inputMode === "camera" ? "CAMERA MODE" : "BARCODE GUN MODE"}
            </span>
          </CardDescription>
        </CardHeader>

        <CardContent className="p-8 space-y-6">
          <button
            onClick={toggleMode}
            className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-2 px-4 rounded-xl flex items-center justify-center gap-2 transition-all text-sm border border-slate-300"
          >
            {inputMode === "camera" ? (
              <>
                <Keyboard size={16} /> Switch to Barcode Gun Mode
              </>
            ) : (
              <>
                <Camera size={16} /> Switch to Camera Mode
              </>
            )}
          </button>

          {/* Camera view — always rendered so #reader is in DOM */}
          <div className={inputMode === "camera" ? "relative group" : "hidden"}>
            <div
              id="reader"
              className="rounded-3xl overflow-hidden bg-slate-900 aspect-square border-4 border-slate-100 shadow-inner"
            />
            {status === "IDLE" && (
              <div className="absolute inset-0 pointer-events-none border-2 border-[#FFBB00]/30 rounded-3xl animate-pulse" />
            )}
          </div>

          {inputMode === "gun" && (
            <div className="bg-slate-900 rounded-3xl aspect-square border-4 border-[#FFBB00] flex items-center justify-center">
              <div className="text-center p-4">
                <Keyboard className="h-16 w-16 text-[#FFBB00] mx-auto mb-4" />
                <p className="text-white font-bold text-lg">BARCODE GUN MODE</p>
                <p className="text-slate-400 text-sm mt-2">Scan now...</p>
                {scanBuffer && (
                  <div className="mt-4 bg-slate-800 p-3 rounded-lg">
                    <p className="text-[#FFBB00] font-mono break-all">
                      Scanning: {scanBuffer}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="min-h-32 flex items-center justify-center text-center">
            {status === "IDLE" && (
              <div className="space-y-2">
                <p className="text-[#0000FF] font-black animate-pulse flex items-center justify-center gap-2">
                  <QrCode size={20} /> READY FOR SCAN...
                </p>
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-tighter">
                  {inputMode === "camera"
                    ? "Point camera at QR code"
                    : "Scan barcode with gun"}
                </p>
              </div>
            )}

            {status === "SCANNING" && (
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="h-8 w-8 animate-spin text-[#0000FF]" />
                <p className="font-black text-[#0000FF] italic">
                  AUTHENTICATING...
                </p>
              </div>
            )}

            {status === "SUCCESS" && info && (
              <div className="w-full bg-green-50 border-2 border-green-500 p-6 rounded-[25px] animate-in zoom-in-95">
                <div className="flex items-center justify-center gap-3 mb-2">
                  <CheckCircle2 className="h-6 w-6 text-green-600" />
                  <span className="text-green-900 font-black text-xl">
                    ACCESS GRANTED
                  </span>
                </div>
                <p className="text-green-700 font-bold text-lg">
                  {info.message?.split(": ")[1] || info.message || "Welcome!"}
                </p>
                <Badge className="bg-green-600 text-white mt-2 px-4 py-1">
                  {info.course || "Attendee"}
                </Badge>
              </div>
            )}

            {status === "ERROR" && (
              <div className="w-full bg-red-50 border-2 border-red-500 p-6 rounded-[25px] animate-in">
                <div className="flex items-center justify-center gap-3 mb-2">
                  <AlertTriangle className="h-6 w-6 text-red-600" />
                  <span className="text-red-900 font-black text-lg uppercase italic">
                    DENIED
                  </span>
                </div>
                <p className="text-red-600 text-sm font-bold">{error}</p>
              </div>
            )}
          </div>
        </CardContent>

        <div className="bg-slate-50 p-4 border-t flex justify-center gap-4 text-slate-400">
          <div
            className={`flex items-center gap-2 text-[10px] font-bold uppercase ${inputMode === "camera" ? "text-[#0000FF]" : ""}`}
          >
            <Camera size={14} /> QR Mode
          </div>
          <span className="text-slate-300">•</span>
          <div
            className={`flex items-center gap-2 text-[10px] font-bold uppercase ${inputMode === "gun" ? "text-[#0000FF]" : ""}`}
          >
            <Keyboard size={14} /> Gun Mode
          </div>
        </div>
      </Card>
    </div>
  );
}
