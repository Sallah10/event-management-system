"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { LogIn, Ticket, Mail, Loader2, ShieldAlert } from "lucide-react";

export default function AssessmentLoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const formData = new FormData(e.currentTarget);
    const email = formData.get("email") as string;
    const ticketId = formData.get("ticketId") as string;

    try {
      const res = await fetch("/api/assessment/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, ticketId }),
      });

      const data = await res.json();

      if (data.success) {
        // Store session for the exam
        localStorage.setItem("user_email", email.toLowerCase());
        localStorage.setItem("user_ticket", ticketId.toUpperCase());
        router.push("/assessment/exam");
      } else {
        setError(data.message);
      }
    } catch (err) {
      setError("Connection error. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#E6E6FF] flex items-center justify-center p-4">
      <Card className="w-full max-w-md border-t-8 border-t-[#0000FF] shadow-2xl">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-2">
            <div className="bg-[#0000FF]/10 p-3 rounded-full">
              <LogIn className="h-8 w-8 text-[#0000FF]" />
            </div>
          </div>
          <CardTitle className="text-2xl font-black text-[#0000FF]">
            PORTAL LOGIN
          </CardTitle>
          <CardDescription>
            Enter your details to start the assessment
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-500 uppercase">
                Email Address
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
                <input
                  name="email"
                  type="email"
                  required
                  placeholder="name@example.com"
                  className="w-full pl-10 pr-4 py-3 rounded-xl border-2 border-gray-100 focus:border-[#0000FF] outline-none transition-all"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-gray-500 uppercase">
                Ticket ID (Barcode)
              </label>
              <div className="relative">
                <Ticket className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
                <input
                  name="ticketId"
                  type="text"
                  required
                  placeholder="TS26-XXXXX"
                  className="w-full pl-10 pr-4 py-3 rounded-xl border-2 border-gray-100 focus:border-[#0000FF] outline-none transition-all uppercase"
                />
              </div>
            </div>

            {error && (
              <div className="bg-red-50 text-red-600 p-3 rounded-lg flex items-center gap-2 text-sm font-bold border border-red-100">
                <ShieldAlert className="h-4 w-4" /> {error}
              </div>
            )}

            <button
              disabled={loading}
              className="w-full bg-[#0000FF] text-white py-4 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-[#0000CC] transition-all disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="animate-spin" />
              ) : (
                "ACCESS ASSESSMENT"
              )}
            </button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
