"use client";

import { useEffect, useRef, useState } from "react";
import { TECHSHIFT_COURSES } from "@/config/course-matrix";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Users,
  BookOpen,
  Send,
  Loader2,
  Timer,
  Sparkles,
  AlertTriangle,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useRouter, usePathname } from "next/navigation";
import TechnicalSupport from "@/components/TechnicalSupport";
import { toast } from "sonner";

export default function TheoryPage() {
  const router = useRouter();
  const pathname = usePathname();
  const [courses, setCourses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSlug, setSelectedSlug] = useState("");
  const [answers, setAnswers] = useState({ q1: "", q2: "", q3: "" });
  const [timeLeft, setTimeLeft] = useState(3600); // 1 Hour
  const [submitting, setSubmitting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  // const [showWarning, setShowWarning] = useState(false);
  const [showWarning, setShowWarning] = useState(false); // Start with false
  const [warningDismissed, setWarningDismissed] = useState(false);
  const [pageLoadTime] = useState(Date.now());
  const [hasHadRealViolation, setHasHadRealViolation] = useState(false);
  const [tabSwitches, setTabSwitches] = useState(0);
  const remindersShown = useRef({
    tenSec: false,
    twoMin: false,
  });
  const warningLevelShown = useRef(0);
  const [userEmail, setUserEmail] = useState("");
  const [userTicket, setUserTicket] = useState("");

  // --- 1. SESSION & STATUS LOCK ---
  useEffect(() => {
    const checkStatus = async () => {
      const email = localStorage.getItem("user_email");
      if (!email) return router.replace("/assessment/login");

      try {
        const res = await fetch("/api/assessment/status");

        if (res.status === 401) {
          return router.replace("/assessment/login");
        }

        const data = await res.json();
        if (!data.success) return router.replace("/assessment/login");

        if (data.isFlagged) {
          return router.replace("/assessment/login?reason=disqualified");
        }

        if (data.status === "registered" || data.status === "attended") {
          return router.replace("/assessment/exam");
        }
        if (data.status === "awarded" || data.status === "shortlisted") {
          return router.replace("/assessment/thank-you");
        }
      } catch (e) {
        console.error("Status check failed");
      }
    };

    checkStatus();

    fetch("/api/assessment/course-slots")
      .then((res) => res.json())
      .then((data) => {
        setCourses(data.availability);
        setLoading(false);
      });
  }, [router]);

  // --- 2. TIMER LOGIC  ---
  useEffect(() => {
    if (timeLeft <= 0) {
      toast.error("Time Expired! Auto-submitting...");
      handleConfirmSubmit();
      return;
    }
    const timer = setInterval(() => setTimeLeft((prev) => prev - 1), 1000);
    return () => clearInterval(timer);
  }, [timeLeft]);

  // --- 3. SECURITY DETECTORS ---
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

  // ===== GRACE PERIOD END NOTIFICATION  =====
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

  // ===== FLAG STATUS POLLING  =====
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
          <p className="font-black text-sm">🎯 FOCUS ON THE EXAM</p>
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

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    toast.warning("Manual Typing Required. Copy-pasting is disabled.");
  };

  const handleConfirmSubmit = async () => {
    setShowConfirm(false);
    setSubmitting(true);
    try {
      const res = await fetch("/api/assessment/submit-theory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: localStorage.getItem("user_email"),
          barcodeId: localStorage.getItem("user_ticket"),
          selectedSlug,
          answers,
        }),
      });
      const result = await res.json();
      if (result.success) {
        router.replace("/assessment/thank-you");
      } else {
        toast.error("Capacity full or submission failed.");
        setSubmitting(false);
      }
    } catch (e) {
      toast.error("Submission failed!");
      setSubmitting(false);
    }
  };

  const dismissWarning = () => {
    setShowWarning(false);
    setWarningDismissed(true);
    sessionStorage.setItem("theory_warning_dismissed", "true");
  };

  return (
    <div className="min-h-screen bg-[#E6E6FF] pb-32">
      {/* (Sticky Header, Courses, Textareas etc remain exactly as you have them, just ensure onPaste={handlePaste} is on the textareas) */}
      {/* ... */}
      <div className="fixed top-0 left-0 w-full bg-[#0000FF] p-5 text-white z-50 flex justify-between items-center border-b-4 border-[#FFBB00] shadow-xl">
        <h1 className="font-black italic uppercase tracking-tighter">
          Stage 2: Theory
        </h1>
        <div className="bg-white/20 px-6 py-2 rounded-full font-mono font-black">
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

      <div className="max-w-4xl mx-auto pt-28 px-6 space-y-10">
        <section className="space-y-4">
          <h2 className="text-[#0000FF] font-black uppercase text-sm tracking-widest">
            1. Select Your Track
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {loading
              ? Array(6)
                  .fill(0)
                  .map((_, i) => (
                    <Skeleton
                      key={i}
                      className="h-24 w-full rounded-4xl bg-white/50"
                    />
                  ))
              : courses.map((c) => (
                  <button
                    key={c.slug}
                    disabled={c.isFull}
                    onClick={() => setSelectedSlug(c.slug)}
                    className={`p-5 rounded-4xl border-2 transition-all text-left ${selectedSlug === c.slug ? "bg-[#0000FF] border-[#0000FF] text-white shadow-2xl" : "bg-white border-white"} ${c.isFull ? "opacity-30 cursor-not-allowed" : ""}`}
                  >
                    <p className="font-bold text-sm leading-tight">
                      {c.displayName}
                    </p>
                    <p className="text-[10px] mt-2 opacity-70 uppercase font-black">
                      {c.isFull ? "Full" : `${c.remaining} left`}
                    </p>
                  </button>
                ))}
          </div>
        </section>

        <section className="space-y-6">
          {[
            { id: "q1", label: `Why do you want to study this track?` },
            { id: "q2", label: "Impact on the Nigerian economy?" },
            { id: "q3", label: `Where do you see yourself in 5 years?` },
          ].map((q, idx) => (
            <Card
              key={q.id}
              className="border-none shadow-2xl rounded-[28px] overflow-hidden"
            >
              <CardHeader className="bg-slate-50 border-b py-5 px-8">
                <CardTitle className="text-sm font-black text-gray-800">
                  Q{idx + 1}. {q.label}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-8">
                <textarea
                  maxLength={1000}
                  onPaste={handlePaste}
                  onCopy={(e) => e.preventDefault()}
                  value={(answers as any)[q.id]}
                  onChange={(e) =>
                    setAnswers({ ...answers, [q.id]: e.target.value })
                  }
                  placeholder="Type your response manually..."
                  className="w-full h-40 p-6 bg-slate-50 rounded-2xl border-2 border-transparent focus:border-[#0000FF] transition-all resize-none font-medium text-gray-700"
                />
                <div className="flex justify-between items-center mt-2 px-2">
                  <span className="text-[10px] text-gray-400 font-bold uppercase tracking-widest italic">
                    No AI • Manual Entry
                  </span>
                  <span className="text-xs font-black text-gray-400">
                    {(answers as any)[q.id].length} / 1,000
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </section>

        <button
          onClick={() => {
            if (!selectedSlug) return toast.error("Please select a track.");
            if (answers.q1.length < 50)
              return toast.error("Answer 1 is too short.");
            setShowConfirm(true);
          }}
          disabled={submitting}
          className="w-full bg-[#FFBB00] text-[#0000FF] py-6 rounded-[30px] font-black text-xl shadow-2xl flex items-center justify-center gap-3 hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50"
        >
          {submitting ? (
            <Loader2 className="animate-spin" />
          ) : (
            "SUBMIT FINAL APPLICATION"
          )}
        </button>
      </div>

      {showConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-100 p-4">
          <div className="bg-white rounded-2xl p-8 max-w-md w-full shadow-2xl">
            <h3 className="text-xl font-black text-[#0000FF] mb-3 italic">
              CONFIRM SUBMISSION
            </h3>
            <p className="text-gray-700 mb-6 font-medium leading-relaxed">
              Ensure your track is correct. You won't be able to edit after
              submission.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 py-3 rounded-xl border-2 border-gray-300 font-bold"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmSubmit}
                className="flex-1 py-3 rounded-xl bg-[#FFBB00] text-[#0000FF] font-black"
              >
                Confirm Submit
              </button>
            </div>
          </div>
        </div>
      )}
      <TechnicalSupport email={userEmail} ticketId={userTicket} />
    </div>
  );
}
