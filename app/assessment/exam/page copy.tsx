"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import questions from "@/config/questions.json";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Timer, AlertTriangle, Send, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function ExamPage() {
  const router = useRouter();
  const [currentAnswers, setCurrentAnswers] = useState<Record<string, string>>(
    {},
  );
  // const [timeLeft, setTimeLeft] = useState(1800); // 30 Minutes
  const [timeLeft, setTimeLeft] = useState(300); // 5 Minutes
  const [tabSwitches, setTabSwitches] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // 1. Timer Logic
  useEffect(() => {
    if (timeLeft <= 0) handleConfirmedSubmit();
    const timer = setInterval(() => setTimeLeft((prev) => prev - 1), 1000);
    return () => clearInterval(timer);
  }, [timeLeft]);

  // 2. DEBUG MODE: Hold 'Shift + D' to pass instantly
  useEffect(() => {
    const handleDebug = (e: KeyboardEvent) => {
      if (e.shiftKey && (e.key === "D" || e.key === "d")) {
        e.preventDefault();
        console.log(
          "🛠 [SYSTEM] Debug Mode Triggered: Preparing 100% Score...",
        );
        const autoAnswers: Record<string, string> = {};
        questions.forEach((q) => {
          autoAnswers[q.id] = q.correct;
        });
        console.log(
          "🛠 Debug: Submitting 100% Score for all",
          questions.length,
          "questions",
        );
        toast.success("DEBUG: 100% Score Injected. Redirecting...");
        handleConfirmedSubmit(autoAnswers);
      }
    };
    window.addEventListener("keydown", handleDebug);
    return () => window.removeEventListener("keydown", handleDebug);
  }, []);

  // 3. Anti-Cheat: Tab Switch Detection
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        setTabSwitches((prev) => prev + 1);
        fetch("/api/assessment/flag", {
          method: "POST",
          body: JSON.stringify({
            email: localStorage.getItem("user_email"),
            barcodeId: localStorage.getItem("user_ticket"),
            reason: "Tab Switching",
          }),
        });

        alert(
          "WARNING: Tab switching is strictly prohibited. Your account has been flagged for review and this activity has been logged.",
        );
        toast.error("SECURITY FLAG: Navigation detected.", {
          description: "Activity logged in system.",
          duration: 10000,
        });
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  // 4. Anti-Cheat: No Copy/Paste
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

  const handleSelect = (qId: string, option: string) => {
    setCurrentAnswers({ ...currentAnswers, [qId]: option });
  };

  const validateAnswers = () => {
    const answered = Object.keys(currentAnswers).length;
    if (answered === 0) {
      toast.error("Please answer at least one question!");
      return false;
    }
    if (answered < questions.length) {
      toast.warning(
        `You've only answered ${answered}/${questions.length} questions.`,
      );
      return false;
    }
    return true;
  };

  const handleSubmitClick = () => {
    if (!validateAnswers()) return;
    setShowConfirm(true);
  };

  const handleConfirmedSubmit = async (answersToSubmit = currentAnswers) => {
    setShowConfirm(false);
    setSubmitting(true);
    try {
      const email = localStorage.getItem("user_email");
      const barcodeId = localStorage.getItem("user_ticket");
      const deviceId = localStorage.getItem("device_id");

      console.log("Submitting with:", { email, barcodeId, deviceId });

      if (!email || !barcodeId || !deviceId) {
        console.error("Missing required fields:", {
          email,
          barcodeId,
          deviceId,
        });
        router.push("/assessment/login");
        return;
      }

      const res = await fetch("/api/assessment/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          barcodeId,
          deviceId,
          answers: answersToSubmit,
          tabSwitches: tabSwitches,
        }),
      });

      const result = await res.json();
      console.log("Submission response:", result);

      if (result.success) {
        localStorage.setItem("latest_result", JSON.stringify(result.data));
        router.push("/assessment/result");
      } else {
        toast.error(result.message);
        setSubmitting(false);
      }
    } catch (err) {
      console.error("Submission error:", err);
      toast.error("Submission error. Please check your connection.");
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#E6E6FF] p-4 pb-24">
      <div className="fixed top-0 left-0 w-full bg-[#0000FF] p-4 text-white z-50 flex justify-between items-center shadow-lg">
        <h1 className="font-black text-[#FFBB00]">
          TECHSHIFT ASSESSMENT <small>(STAGE 1)</small>
        </h1>

        <div className="flex items-center gap-2 bg-white/20 px-4 py-1 rounded-full font-mono">
          <Timer className="h-4 w-4" />
          {Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, "0")}
        </div>
      </div>

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
            onClick={handleSubmitClick}
            disabled={submitting}
            className="w-full bg-[#FFBB00] text-[#0000FF] py-4 rounded-2xl font-black text-lg shadow-xl flex items-center justify-center gap-2 hover:scale-[1.02] transition-all disabled:opacity-50"
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

      {/* Confirmation Dialog */}
      {showConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-8 max-w-md w-full shadow-2xl">
            <h3 className="text-xl font-black text-[#0000FF] mb-3">
              Confirm Submission
            </h3>
            <p className="text-gray-700 mb-6 leading-relaxed">
              Are you sure you want to submit? You won't be able to change your
              answers after submission.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                className="flex-1 py-3 rounded-xl border-2 border-gray-300 font-bold text-gray-700 hover:bg-gray-50 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={() => handleConfirmedSubmit()}
                className="flex-1 py-3 rounded-xl bg-[#FFBB00] text-[#0000FF] font-black hover:scale-105 transition-all"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// former tab swicthing chek : 2. MULTI-WINDOW & SPLIT SCREEN DETECTION
// useEffect(() => {
//   const flagAction = async (reason: string) => {
//     if (Date.now() - pageLoadTime < 60000) {
//       console.log("Ignoring flag during grace period:", reason);
//       return;
//     }

//     setHasHadRealViolation(true);

//     try {
//       const res = await fetch("/api/assessment/flag", {
//         method: "POST",
//         headers: { "Content-Type": "application/json" },
//         body: JSON.stringify({ reason }),
//       });

//       const data = await res.json();

//       // Show appropriate message based on flag count
//       if (data.warning) {
//         if (data.flagCount === 1) {
//           toast.warning(data.message, {
//             duration: 5000,
//             icon: "⚠️",
//           });
//         } else if (data.flagCount === 2) {
//           toast.error(data.message, {
//             duration: 6000,
//             icon: "🚨",
//           });
//         }
//       }

//       // Handle logout
//       if (data.forceLogout) {
//         toast.error(data.message, { duration: 3000 });
//         setTimeout(() => {
//           localStorage.clear();
//           router.push("/assessment/login?reason=disqualified");
//         }, 2000);
//       }
//     } catch (error) {
//       console.error("Flag error:", error);
//     }
//   };

//   const handleVisibilityChange = () => {
//     if (document.visibilityState === "hidden") {
//       setTabSwitches((prev) => prev + 1);
//       flagAction("Tab/Window Hidden");
//       alert(
//         "🚨 WARNING: Tab switching is strictly prohibited. Your activity has been logged.",
//       );
//     }
//   };

//   const handleBlur = () => {
//     flagAction("Lost Window Focus");
//     toast.error("SECURITY ALERT: Do not leave the assessment window.");
//   };

//   const handleResize = () => {
//     if (window.innerWidth < 800) {
//       // Detection for split screen
//       flagAction("Window Resized/Split Screen");
//       toast.error("SECURITY ALERT: Split screen mode is prohibited.");
//     }
//   };

//   document.addEventListener("visibilitychange", handleVisibilityChange);
//   window.addEventListener("blur", handleBlur);
//   window.addEventListener("resize", handleResize);

//   return () => {
//     document.removeEventListener("visibilitychange", handleVisibilityChange);
//     window.removeEventListener("blur", handleBlur);
//     window.removeEventListener("resize", handleResize);
//   };
// }, []);
