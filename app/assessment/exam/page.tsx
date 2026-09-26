"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation"; // Added usePathname
import questions from "@/config/questions.json";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Timer, AlertTriangle, Send, Loader2 } from "lucide-react";
import { toast } from "sonner";
import TechnicalSupport from "@/components/TechnicalSupport";

export default function ExamPage() {
  const router = useRouter();
  const pathname = usePathname(); // Fix for pathName error
  const [currentAnswers, setCurrentAnswers] = useState<Record<string, string>>(
    {},
  );
  const [timeLeft, setTimeLeft] = useState(1800); // 30 Minutes
  const [tabSwitches, setTabSwitches] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showWarning, setShowWarning] = useState(false);
  const [warningDismissed, setWarningDismissed] = useState(() => {
    // Check on initial load if warning was dismissed in this session
    if (typeof window !== "undefined") {
      return sessionStorage.getItem("exam_warning_dismissed") === "true";
    }
    return false;
  });
  const [userEmail, setUserEmail] = useState("");
  const [userTicket, setUserTicket] = useState("");
  const [pageLoadTime] = useState(Date.now());
  const [hasHadRealViolation, setHasHadRealViolation] = useState(false);
  // Add these refs
  const remindersShown = useRef({
    tenSec: false,
    twoMin: false,
  });
  const warningLevelShown = useRef(0);

  // --- 1. SECURITY & NAVIGATION LOCK ---
  useEffect(() => {
    const checkStatus = async () => {
      const email = localStorage.getItem("user_email");
      const ticket = localStorage.getItem("user_ticket");
      if (!email || !ticket) return router.replace("/assessment/login");

      try {
        const res = await fetch("/api/assessment/status");

        if (res.status === 401) {
          // No valid cookie — send back to login
          return router.replace("/assessment/login");
        }

        const data = await res.json();
        if (!data.success) return router.replace("/assessment/login");

        if (data.isFlagged) {
          return router.replace("/assessment/login?reason=disqualified");
        }

        if (data.status === "qualified") {
          return router.replace("/assessment/theory");
        }
        if (data.status === "awarded" || data.status === "shortlisted") {
          return router.replace("/assessment/thank-you");
        }
      } catch (e) {
        console.error("Session check failed");
      }
    };
    checkStatus();
  }, [router]);

  // ===== GRACE PERIOD END NOTIFICATION (no time revealed) =====
  useEffect(() => {
    const timer = setTimeout(() => {
      toast.info(
        <div className="flex flex-col gap-1">
          <p className="font-black text-sm">⚠️ ACTIVE MONITORING</p>
          <p className="text-xs">
            Your assessment is now being actively monitored. Any tab switching
            or window changes will be logged.
          </p>
        </div>,
        {
          duration: 5000,
          icon: "⚠️",
          style: {
            background: "#E6E6FF",
            color: "#0000FF",
            border: "2px solid #0000FF",
            borderRadius: "12px",
          },
        },
      );
    }, 20000); // 20 seconds

    return () => clearTimeout(timer);
  }, []);

  // --- 2. MULTI-WINDOW & SPLIT SCREEN DETECTION ---
  useEffect(() => {
    const GRACE_MS = 30000; // 30 seconds

    const flagAction = async (reason: string) => {
      setHasHadRealViolation(true);

      try {
        const res = await fetch("/api/assessment/flag", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
        });

        const data = await res.json();

        if (data.warning) {
          if (data.flagCount === 1) {
            toast.warning(data.message, { duration: 5000, icon: "⚠️" });
          } else if (data.flagCount === 2) {
            toast.error(data.message, { duration: 6000, icon: "🚨" });
          }
        }

        if (data.forceLogout) {
          toast.error(data.message, { duration: 3000 });
          setTimeout(() => {
            localStorage.clear();
            router.push("/assessment/login?reason=disqualified");
          }, 2000);
        }
      } catch (error) {
        console.error("Flag error:", error);
      }
    };

    // At exactly 30s, actively check if a violation is still present
    // This catches anyone who set up split screen during grace and left it open
    const graceEndTimer = setTimeout(() => {
      if (window.innerWidth < 800) {
        flagAction("Split screen active after grace period");
        toast.error(
          "🚨 SECURITY: Split screen detected. Close it immediately.",
          {
            duration: 6000,
          },
        );
      }
      if (document.visibilityState === "hidden") {
        flagAction("Tab hidden after grace period");
      }
    }, GRACE_MS);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        if (Date.now() - pageLoadTime < GRACE_MS) {
          console.log("Ignoring visibility change during grace period");
          return;
        }
        setTabSwitches((prev) => prev + 1);
        flagAction("Tab/Window Hidden");
        alert(
          "🚨 WARNING: Tab switching is strictly prohibited. Your activity has been logged.",
        );
      }
    };

    const handleBlur = () => {
      if (Date.now() - pageLoadTime < GRACE_MS) return;
      flagAction("Lost Window Focus");
      toast.error("SECURITY ALERT: Do not leave the assessment window.");
    };

    const handleResize = () => {
      if (Date.now() - pageLoadTime < GRACE_MS) return;
      if (window.innerWidth < 800) {
        flagAction("Window Resized/Split Screen");
        toast.error("SECURITY ALERT: Split screen mode is prohibited.");
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", handleBlur);
    window.addEventListener("resize", handleResize);

    return () => {
      clearTimeout(graceEndTimer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("resize", handleResize);
    };
  }, [pageLoadTime, router]);

  // --- 3. TIMER LOGIC ---
  useEffect(() => {
    if (timeLeft <= 0) {
      toast.info("Time Expired! Auto-submitting...");
      handleConfirmedSubmit();
      return;
    }
    const timer = setInterval(() => setTimeLeft((prev) => prev - 1), 1000);
    return () => clearInterval(timer);
  }, [timeLeft]);

  // --- 4. NO COPY/PASTE/RIGHT-CLICK ---
  useEffect(() => {
    const prevent = (e: any) => e.preventDefault();
    document.addEventListener("copy", prevent);
    document.addEventListener("paste", prevent);
    document.addEventListener("contextmenu", prevent);
    return () => {
      document.removeEventListener("copy", prevent);
      document.removeEventListener("paste", prevent);
      document.removeEventListener("contextmenu", prevent);
    };
  }, []);

  // Poll for flag status every 8 seconds
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/assessment/flag-status");
        const data = await res.json();

        if (data.success) {
          // Check database flag first
          if (data.isFlagged) {
            toast.error("❌ DISQUALIFIED: Multiple violations detected.", {
              duration: 3000,
              icon: "🚫",
            });
            localStorage.clear();
            sessionStorage.clear();
            router.push("/assessment/login?reason=disqualified");
            return;
          }

          // First warning - only show once
          if (
            data.flagCount === 1 &&
            !warningDismissed &&
            warningLevelShown.current < 1
          ) {
            warningLevelShown.current = 1;
            setShowWarning(true);
            setTimeout(() => setShowWarning(false), 8000);
            toast.warning("⚠️ FIRST WARNING: Tab switching detected!", {
              duration: 5000,
            });
          }

          // Final warning - only show once
          if (data.flagCount === 2 && warningLevelShown.current < 2) {
            warningLevelShown.current = 2;
            toast.error("🚨 FINAL WARNING: Last chance!", {
              duration: 6000,
            });
          }

          // Disqualification
          if (data.flagCount >= 3) {
            toast.error("❌ DISQUALIFIED", { duration: 3000 });
            localStorage.clear();
            sessionStorage.clear();
            router.push("/assessment/login?reason=disqualified");
          }
        }
      } catch (e) {
        // Silent fail
      }
    }, 8000);

    return () => clearInterval(interval);
  }, [router, warningDismissed]);

  // Record exam start time for grace period
  useEffect(() => {
    const recordStartTime = async () => {
      try {
        await fetch("/api/assessment/start-exam", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        console.log("⏱️ Exam start time recorded");
      } catch (error) {
        console.error("Failed to record start time:", error);
      }
    };

    recordStartTime();
  }, []);

  useEffect(() => {
    // Disable back button and track presses
    window.history.pushState(null, "", window.location.href);

    let backPressCount = 0;
    const maxBackPresses = 1; // First warning, second logout

    const handlePopState = async (event: PopStateEvent) => {
      event.preventDefault();
      backPressCount++;

      if (backPressCount === 1) {
        // First back press - warning only
        toast.warning(
          "⚠️ Using browser back button is not allowed. Please use the navigation inside the exam.",
          {
            duration: 5000,
            icon: "⚠️",
            style: {
              background: "#FFBB00",
              color: "#0000FF",
              fontWeight: "bold",
            },
          },
        );

        // Push state again to prevent exit
        window.history.pushState(null, "", window.location.href);

        // Log this as a warning (but don't count as flag yet)
        await fetch("/api/assessment/back-button-warning", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "warning" }),
        });
      } else if (backPressCount >= 2) {
        // Second back press - logout and flag
        toast.error("❌ Disqualified: Multiple back button presses detected.", {
          duration: 3000,
          icon: "❌",
          style: {
            background: "#FF0000",
            color: "white",
            fontWeight: "bold",
          },
        });

        // Clear session
        localStorage.clear();
        sessionStorage.clear();

        // Redirect after delay
        setTimeout(() => {
          router.push("/assessment/login?reason=back_button");
        }, 2000);
      }
    };

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [router]);

  useEffect(() => {
    setUserEmail(localStorage.getItem("user_email") || "");
    setUserTicket(localStorage.getItem("user_ticket") || "");
  }, []);

  // ===== 10-SECOND REMINDER =====
  useEffect(() => {
    const timer = setTimeout(() => {
      if (remindersShown.current.tenSec) return;
      remindersShown.current.tenSec = true;

      toast.info(
        <div className="flex flex-col gap-1">
          <p className="font-black text-sm"> FOCUS ON THE EXAM</p>
          <p className="text-xs">
            Keep this window active. Any tab switching or split screen will be
            detected.
          </p>
        </div>,
        {
          duration: 5000,
          icon: "🎯",
          style: {
            background: "#E6E6FF",
            color: "#0000FF",
            border: "2px solid #0000FF",
            borderRadius: "12px",
          },
        },
      );
    }, 10000); // 10 seconds

    return () => clearTimeout(timer);
  }, []);

  // ===== 2-MINUTE REMINDER =====
  useEffect(() => {
    const timer = setTimeout(() => {
      if (remindersShown.current.twoMin) return;
      remindersShown.current.twoMin = true;

      toast.info(
        <div className="flex flex-col gap-1">
          <p className="font-black text-sm">📋 REMINDER</p>
          <p className="text-xs">
            No tab switching. No copy/paste. No AI. Stay focused!
          </p>
        </div>,
        {
          duration: 5000,
          icon: "📋",
          style: {
            background: "#E6E6FF",
            color: "#0000FF",
            border: "2px solid #0000FF",
            borderRadius: "12px",
          },
        },
      );
    }, 120000); // 2 minutes

    return () => clearTimeout(timer);
  }, []);

  const handleSelect = (qId: string, option: string) => {
    setCurrentAnswers({ ...currentAnswers, [qId]: option });
  };

  const handleConfirmedSubmit = async (answersToSubmit = currentAnswers) => {
    setShowConfirm(false);
    setSubmitting(true);
    try {
      const res = await fetch("/api/assessment/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: localStorage.getItem("user_email"),
          barcodeId: localStorage.getItem("user_ticket"),
          deviceId: localStorage.getItem("device_id"),
          answers: answersToSubmit,
          tabSwitches: tabSwitches,
        }),
      });

      const result = await res.json();
      if (result.success) {
        localStorage.setItem("latest_result", JSON.stringify(result.data));
        router.replace("/assessment/result");
      } else {
        toast.error(result.message);
        setSubmitting(false);
      }
    } catch (err) {
      toast.error("Submission error. Please check your connection.");
      setSubmitting(false);
    }
  };

  const dismissWarning = () => {
    setShowWarning(false);
    setWarningDismissed(true);
    sessionStorage.setItem("exam_warning_dismissed", "true");
  };

  return (
    <div className="min-h-screen bg-[#E6E6FF] p-4 pb-24">
      <div className="fixed top-0 left-0 w-full bg-[#0000FF] p-4 text-white z-50 flex justify-between items-center shadow-lg">
        <h1 className="font-black text-[#FFBB00]">
          TECHSHIFT ASSESSMENT <small>(STAGE 1)</small>
        </h1>
        <div className="flex items-center gap-2 bg-white/20 px-4 py-1 rounded-full font-mono font-bold">
          <Timer className="h-4 w-4" />
          {Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, "0")}
        </div>
      </div>
      {showWarning && (
        <div className="fixed top-20 left-0 right-0 z-60 mx-4 animate-in slide-in-from-top">
          <div className="bg-[#FFBB00] text-[#0000FF] p-4 rounded-2xl shadow-2xl border-2 border-[#0000FF] max-w-2xl mx-auto">
            <div className="flex items-start gap-3">
              <span className="text-2xl mt-1">⚠️</span>
              <div className="flex-1">
                <p className="font-black text-lg">Violation Detected</p>
                <p className="text-sm font-bold">
                  Tab switching has been detected. This is your first warning.
                  One more violation will result in automatic disqualification.
                </p>
              </div>
              <button
                onClick={dismissWarning}
                className="bg-[#0000FF] text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-[#0000CC] transition-all"
              >
                GOT IT
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="max-w-2xl mx-auto mt-20 space-y-6">
        {questions.map((q, idx) => (
          <Card key={q.id} className="border-none shadow-xl">
            <CardHeader className="bg-white border-b">
              <CardTitle className="text-[#0000FF] text-lg">
                <span className="opacity-50 mr-2">#{idx + 1}</span> {q.question}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 grid grid-cols-1 gap-3">
              {Object.entries(q.options).map(([key, value]) => (
                <button
                  key={key}
                  onClick={() => handleSelect(q.id, key)}
                  className={`flex items-center p-4 rounded-xl border-2 transition-all text-left font-bold ${
                    currentAnswers[q.id] === key
                      ? "border-[#0000FF] bg-[#E6E6FF] text-[#0000FF]"
                      : "border-gray-100 hover:border-gray-300 bg-gray-50 text-gray-700"
                  }`}
                >
                  <span className="mr-4 w-8 h-8 flex items-center justify-center bg-white rounded-full border shadow-sm shrink-0">
                    {key}
                  </span>
                  {value}
                </button>
              ))}
            </CardContent>
          </Card>
        ))}

        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 w-full max-w-2xl px-4">
          <button
            onClick={() => {
              if (Object.keys(currentAnswers).length < questions.length) {
                toast.warning(
                  `Warning: You have only answered ${Object.keys(currentAnswers).length}/${questions.length} questions.`,
                );
              }
              setShowConfirm(true);
            }}
            disabled={submitting}
            className="w-full bg-[#FFBB00] text-[#0000FF] py-4 rounded-2xl font-black text-lg shadow-xl flex items-center justify-center gap-2 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50"
          >
            {submitting ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : (
              <>
                <Send className="h-6 w-6" /> SUBMIT ASSESSMENT
              </>
            )}
          </button>
        </div>
      </div>

      {showConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-100 p-4">
          <div className="bg-white rounded-2xl p-8 max-w-md w-full shadow-2xl">
            <h3 className="text-xl font-black text-[#0000FF] mb-3 text-center italic">
              CONFIRM SUBMISSION
            </h3>
            <p className="text-gray-600 mb-6 text-center font-medium leading-relaxed">
              Ready to lock in your responses? You cannot go back after clicking
              confirm.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 py-3 rounded-xl border-2 border-gray-300 font-bold text-gray-500"
              >
                Cancel
              </button>
              <button
                onClick={() => handleConfirmedSubmit()}
                className="flex-1 py-3 rounded-xl bg-[#0000FF] text-white font-black shadow-lg"
              >
                Submit Now
              </button>
            </div>
          </div>
        </div>
      )}

      <TechnicalSupport email={userEmail} ticketId={userTicket} />
    </div>
  );
}
