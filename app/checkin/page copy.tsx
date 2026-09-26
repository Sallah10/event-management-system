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

  const html5QrCode = useRef<Html5Qrcode | null>(null);
  const hardwareInputRef = useRef<HTMLInputElement>(null);
  const isProcessing = useRef(false);
  const lastScanRef = useRef<string>("");
  const scanBufferRef = useRef<string>("");
  const scanTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // --- UNIFIED VERIFICATION LOGIC ---
  const handleVerify = useCallback(
    async (barcodeId: string) => {
      const cleanId = barcodeId.trim().toUpperCase();

      if (cleanId === lastScanRef.current) return;
      if (!cleanId || isProcessing.current) return;

      console.log("Verifying:", cleanId);

      lastScanRef.current = cleanId;
      isProcessing.current = true;

      setStatus("SCANNING");
      setError("");

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

          setTimeout(() => {
            setStatus("IDLE");
            setInfo(null);
            isProcessing.current = false;
            lastScanRef.current = "";

            // Resume camera if in camera mode - FIXED: no .catch()
            if (inputMode === "camera" && html5QrCode.current?.isScanning) {
              try {
                html5QrCode.current.resume();
              } catch (error) {
                console.log("Could not resume camera");
              }
            }

            if (hardwareInputRef.current) {
              hardwareInputRef.current.value = "";
              hardwareInputRef.current.focus();
            }
          }, 3000);
        } else {
          setStatus("ERROR");
          setError(data.message || "Check-in failed");
          if (navigator.vibrate) navigator.vibrate([100, 50, 100, 50, 100]);

          setTimeout(() => {
            setStatus("IDLE");
            isProcessing.current = false;
            lastScanRef.current = "";

            if (inputMode === "camera" && html5QrCode.current?.isScanning) {
              try {
                html5QrCode.current.resume();
              } catch (error) {
                console.log("Could not resume camera");
              }
            }

            if (hardwareInputRef.current) {
              hardwareInputRef.current.value = "";
              hardwareInputRef.current.focus();
            }
          }, 4000);
        }
      } catch (err) {
        console.error("Network error:", err);
        setStatus("ERROR");
        setError("Network error. Try again.");

        setTimeout(() => {
          setStatus("IDLE");
          isProcessing.current = false;
          lastScanRef.current = "";
          if (hardwareInputRef.current) {
            hardwareInputRef.current.value = "";
            hardwareInputRef.current.focus();
          }
        }, 4000);
      }
    },
    [inputMode],
  );

  // --- CAMERA SCANNER ---
  const startCamera = useCallback(async () => {
    try {
      const readerElement = document.getElementById("reader");
      if (!readerElement) {
        console.log("Reader element not ready yet");
        return;
      }

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.log("Camera not supported");
        setInputMode("gun");
        return;
      }

      if (!html5QrCode.current) {
        html5QrCode.current = new Html5Qrcode("reader");
      }

      if (html5QrCode.current.isScanning) {
        try {
          await html5QrCode.current.stop();
        } catch (error) {
          // Ignore stop errors
        }
      }

      setInputMode("camera");

      await html5QrCode.current.start(
        { facingMode: "environment" },
        {
          fps: 20,
          qrbox: { width: 280, height: 280 },
          aspectRatio: 1.0,
        },
        async (decodedText) => {
          if (!isProcessing.current) {
            // FIXED: pause doesn't return Promise, so no await needed
            if (html5QrCode.current?.isScanning) {
              try {
                html5QrCode.current.pause();
              } catch (error) {
                console.log("Could not pause camera");
              }
            }
            handleVerify(decodedText);
          }
        },
        () => {},
      );
    } catch (err: any) {
      console.log("Camera error, switching to gun mode");
      setInputMode("gun");
    }
  }, [handleVerify]);

  // --- BARCODE GUN HANDLER ---
  const handleBarcodeInput = useCallback(
    (e: KeyboardEvent) => {
      if (isProcessing.current) return;

      if (e.key === "Shift") return;

      if (
        e.key === "Control" ||
        e.key === "Alt" ||
        e.key === "Meta" ||
        e.key === "Tab" ||
        e.key.startsWith("F")
      ) {
        return;
      }

      if (scanTimeoutRef.current) {
        clearTimeout(scanTimeoutRef.current);
        scanTimeoutRef.current = null;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();

        const barcode = scanBufferRef.current.trim();
        console.log("Enter pressed, barcode:", barcode);

        if (barcode && barcode.length > 3) {
          // FIXED: pause doesn't return Promise
          if (inputMode === "camera" && html5QrCode.current?.isScanning) {
            try {
              html5QrCode.current.pause();
            } catch (error) {
              console.log("Could not pause camera");
            }
          }

          handleVerify(barcode);

          scanBufferRef.current = "";
          setScanBuffer("");

          if (hardwareInputRef.current) {
            hardwareInputRef.current.value = "";
          }
        }
        return;
      }

      if (e.key.length === 1) {
        e.preventDefault();
        e.stopPropagation();

        scanBufferRef.current += e.key;
        setScanBuffer(scanBufferRef.current);

        if (hardwareInputRef.current) {
          hardwareInputRef.current.value = scanBufferRef.current;
        }

        scanTimeoutRef.current = setTimeout(() => {
          if (scanBufferRef.current.length > 0) {
            console.log("Scan timeout - clearing buffer");
            scanBufferRef.current = "";
            setScanBuffer("");
            if (hardwareInputRef.current) {
              hardwareInputRef.current.value = "";
            }
          }
          scanTimeoutRef.current = null;
        }, 300);
      }
    },
    [handleVerify, inputMode],
  );

  // --- SETUP ---
  useEffect(() => {
    startCamera();

    window.addEventListener("keydown", handleBarcodeInput);

    const focusInput = () => {
      if (hardwareInputRef.current && !isProcessing.current) {
        hardwareInputRef.current.focus();
      }
    };

    document.addEventListener("click", focusInput);

    setTimeout(focusInput, 500);

    return () => {
      window.removeEventListener("keydown", handleBarcodeInput);
      document.removeEventListener("click", focusInput);

      if (scanTimeoutRef.current) {
        clearTimeout(scanTimeoutRef.current);
      }

      if (html5QrCode.current?.isScanning) {
        // FIXED: stop might return Promise, so we can use catch here
        try {
          html5QrCode.current.stop().catch((error) => {
            console.log("Stop error:", error);
          });
        } catch (error) {
          console.log("Could not stop camera");
        }
      }
    };
  }, [startCamera, handleBarcodeInput]);

  // --- TOGGLE MODE ---
  const toggleMode = async () => {
    if (inputMode === "camera") {
      if (html5QrCode.current?.isScanning) {
        try {
          html5QrCode.current.pause(); // FIXED: no await needed
        } catch (error) {
          console.log("Could not pause camera");
        }
      }
      setInputMode("gun");
    } else {
      setInputMode("camera");
      await startCamera();
    }
    hardwareInputRef.current?.focus();
  };

  // Dev tool
  if (process.env.NODE_ENV === "development") {
    (window as any).testCheckin = handleVerify;
  }

  return (
    <div className="min-h-screen bg-[#E6E6FF] flex items-center justify-center p-4 font-sans">
      <Card className="w-full max-w-md border-2 border-[#0000FF] shadow-2xl bg-white overflow-hidden rounded-[40px]">
        <input
          ref={hardwareInputRef}
          type="text"
          className="absolute opacity-0 pointer-events-none"
          autoFocus
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

          {inputMode === "camera" && (
            <div className="relative group">
              <div
                id="reader"
                className="rounded-3xl overflow-hidden bg-slate-900 aspect-square border-4 border-slate-100 shadow-inner"
              ></div>
              {status === "IDLE" && (
                <div className="absolute inset-0 pointer-events-none border-2 border-[#FFBB00]/30 rounded-3xl animate-pulse"></div>
              )}
            </div>
          )}

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
