"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Trophy,
  ArrowRight,
  XCircle,
  AlertTriangle,
  ExternalLink,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function ResultPage() {
  const router = useRouter();
  const [data, setData] = useState<any>(null);
  const [showRulesFlash, setShowRulesFlash] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("latest_result");
    if (!saved) return router.push("/assessment/login");
    const parsed = JSON.parse(saved);
    setData(parsed);
    if (!parsed.qualified) {
      localStorage.removeItem("user_email");
      localStorage.removeItem("user_ticket");
      localStorage.removeItem("device_id");
      // We leave "latest_result" so they can still see their score until they leave the page
    }
  }, [router]);

  if (!data) return null;
  const isQualified = data.qualified;

  return (
    <div className="min-h-screen bg-[#E6E6FF] flex items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-lg"
      >
        {/* THE RULES FLASH OVERLAY */}
        <AnimatePresence>
          {showRulesFlash && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="fixed inset-0 z-100 bg-[#0000FF] p-6 flex items-center justify-center"
            >
              <div className="bg-white p-8 rounded-[32px] max-w-md w-full shadow-2xl space-y-6">
                <h2 className="text-3xl font-black text-[#0000FF] italic flex items-center gap-2">
                  <AlertTriangle className="text-[#FFBB00]" /> REMEMBER!
                </h2>
                <div className="space-y-4 text-gray-700 font-bold uppercase text-xs tracking-wider">
                  <p>1. Multiple device logins = Disqualification</p>
                  <p>2. No copying and pasting allowed</p>
                  <p>3. No use of AI (Strictly monitored)</p>
                  <p>4. Opening new tabs is prohibited</p>
                  <p className="text-[#0000FF] bg-blue-50 p-2 rounded-lg">
                    5. Ranking is FIRST COME, FIRST SERVE not based on scores
                  </p>
                </div>
                <button
                  onClick={() => router.push("/assessment/theory")}
                  className="w-full bg-[#0000FF] text-white py-5 rounded-2xl font-black text-lg shadow-xl"
                >
                  START THEORY NOW
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <Card className="border-none shadow-2xl overflow-hidden rounded-[40px]">
          <div
            className={`p-10 text-center text-white ${isQualified ? "bg-[#0000FF]" : "bg-red-600"} -mt-10 relative`}
          >
            <h1 className="text-2xl font-black italic uppercase leading-tight">
              {isQualified ? "Congratulations!" : "Oops! "}
            </h1>
            <p className="mt-2 text-sm opacity-90 font-bold uppercase tracking-widest">
              {isQualified
                ? // ? "You just completed the objective session. Now proceed with the Theory"
                  "You made it!"
                : "You didn't meet the cut-off mark this time. Try again next stream."}
            </p>
          </div>

          <CardContent className="p-8 space-y-8 bg-white">
            {/* THE 2 NUMBERS REQUIREMENT */}
            {/* <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-50 p-6 rounded-3xl border-2 border-gray-100 text-center">
                <p className="text-[10px] font-black text-gray-400 uppercase mb-2">
                  1. Your Score + 80%
                </p>
                <p
                  className={`text-4xl font-black ${isQualified ? "text-[#0000FF]" : "text-red-500"}`}
                >
                  {data.score}%{" "}
                  <span className="text-xs text-gray-400">/ 80%</span>
                </p>
              </div>
              <div className="bg-slate-50 p-6 rounded-3xl border-2 border-gray-100 text-center">
                <p className="text-[10px] font-black text-gray-400 uppercase mb-2">
                  2. Submission -#
                </p>
                <p className="text-4xl font-black text-gray-800">
                  #{data.submissionRank}
                </p>
              </div>
            </div> */}
            {/* STATS SECTION */}
            <div
              className={`grid ${isQualified ? "grid-cols-2" : "grid-cols-1"} gap-4`}
            >
              {/* Score Card - Always Show */}
              <div className="bg-slate-50 p-6 rounded-3xl border-2 border-gray-100 text-center">
                <p className="text-[10px] font-black text-gray-400 uppercase mb-2">
                  Your Score
                </p>
                <p
                  className={`text-4xl font-black ${isQualified ? "text-[#0000FF]" : "text-red-500"}`}
                >
                  {data.score}%{" "}
                  <span className="text-xs text-gray-400">/ 80%</span>
                </p>
              </div>

              {/* Rank Card - Only Show for Qualified */}
              {isQualified && data.submissionRank && (
                <div className="bg-slate-50 p-6 rounded-3xl border-2 border-gray-100 text-center">
                  <p className="text-[10px] font-black text-gray-400 uppercase mb-2">
                    Your Rank
                  </p>
                  <p className="text-4xl font-black text-[#0000FF]">
                    #{data.submissionRank}
                  </p>
                  <p className="text-[8px] text-gray-400 mt-1">
                    among qualified candidates
                  </p>
                </div>
              )}
            </div>

            {/* MESSAGE BODY */}
            <div
              className={`p-6 rounded-3xl flex flex-col items-center text-center gap-3 ${isQualified ? "bg-blue-50" : "bg-red-50"}`}
            >
              {isQualified ? (
                <Trophy className="text-[#0000FF] h-10 w-10" />
              ) : (
                <XCircle className="text-red-500 h-10 w-10" />
              )}
              <p className="text-sm font-bold text-gray-700 leading-relaxed italic">
                {data.message}
              </p>
            </div>

            {/* ACTION BUTTONS */}
            {isQualified ? (
              <button
                onClick={() => setShowRulesFlash(true)}
                className="w-full bg-[#FFBB00] text-[#0000FF] py-6 rounded-[24px] font-black text-xl shadow-[0_15px_35px_rgba(255,187,0,0.4)] flex items-center justify-center gap-2 hover:scale-[1.02] transition-all"
              >
                PROCEED TO THEORY <ArrowRight />
              </button>
            ) : (
              <a
                href="https://forms.gle/JLWKJyFJwQXCuQqG6"
                target="_blank"
                className="w-full bg-gray-900 text-white py-6 rounded-[24px] font-black text-sm md:text-md flex items-center justify-center gap-2"
              >
                JOIN NEXT STREAM WAITLIST <ExternalLink size={18} />
              </a>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
