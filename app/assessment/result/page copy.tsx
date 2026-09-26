"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import questions from "@/config/questions.json";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Timer, AlertTriangle, Send } from "lucide-react";
import { toast } from "sonner"; // Premium toasts

export default function ExamPage() {
  const router = useRouter();
  const [currentAnswers, setCurrentAnswers] = useState<Record<string, string>>(
    {},
  );
  const [timeLeft, setTimeLeft] = useState(1800); // 30 Minutes
  const [tabSwitches, setTabSwitches] = useState(0);

  // 1. Timer Logic
  useEffect(() => {
    if (timeLeft <= 0) handleSubmit();
    const timer = setInterval(() => setTimeLeft((prev) => prev - 1), 1000);
    return () => clearInterval(timer);
  }, [timeLeft]);

  // 2. DEBUG MODE: Hold 'Shift + D' to pass instantly
  useEffect(() => {
    const handleDebug = (e: KeyboardEvent) => {
      if (e.shiftKey && e.key === "D") {
        toast.info("🛠 Debug Mode: Generating 100% Score...");
        const autoAnswers: Record<string, string> = {};
        questions.forEach((q) => (autoAnswers[q.id] = q.correct));
        handleSubmit(autoAnswers);
      }
    };
    window.addEventListener("keydown", handleDebug);
    return () => window.removeEventListener("keydown", handleDebug);
  }, [currentAnswers]);

  // 3. Anti-Cheat: Tab Switch Detection
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        setTabSwitches((prev) => prev + 1);
        toast.error(
          "🚨 WARNING: Tab switching is monitored. Activity flagged.",
        );
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

  const handleSubmit = async (answersToSubmit = currentAnswers) => {
    try {
      const email = localStorage.getItem("user_email");
      const barcodeId = localStorage.getItem("user_ticket");
      const deviceId = localStorage.getItem("device_id");

      if (!email || !barcodeId) {
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
      if (result.success) {
        localStorage.setItem("latest_result", JSON.stringify(result.data));
        router.push("/assessment/result");
      } else {
        toast.error(result.message);
      }
    } catch (err) {
      toast.error("Submission error. Please check your connection.");
    }
  };

  return (
    <div className="min-h-screen bg-[#E6E6FF] p-4 pb-24">
      <div className="fixed top-0 left-0 w-full bg-[#0000FF] p-4 text-white z-50 flex justify-between items-center shadow-lg">
        <h1 className="font-black text-[#FFBB00]">TECHSHIFT ASSESSMENT</h1>
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
            onClick={() => handleSubmit()}
            className="w-full bg-[#FFBB00] text-[#0000FF] py-4 rounded-2xl font-black text-lg shadow-xl flex items-center justify-center gap-2 hover:scale-[1.02] transition-all"
          >
            <Send className="h-6 w-6" /> SUBMIT ASSESSMENT
          </button>
        </div>
      </div>
    </div>
  );
}
