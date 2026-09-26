"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { LogIn, Ticket, Mail, Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const reason = searchParams.get("reason");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [acceptedRules, setAcceptedRules] = useState(false);
  const [isClient, setIsClient] = useState(false);

  // Set isClient to true after hydration
  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    if (reason === "disqualified") {
      toast.error("❌ You have been disqualified due to multiple violations.", {
        duration: 8000,
        style: {
          background: "#FF0000",
          color: "white",
          fontWeight: "bold",
        },
      });
    }
  }, [reason]);

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!acceptedRules) {
      setError("You must accept the Rules of Engagement to proceed.");
      return;
    }

    setLoading(true);
    setError("");

    const formData = new FormData(e.currentTarget);
    const email = formData.get("email") as string;
    const ticketId = formData.get("ticketId") as string;

    // Generate fingerprint only on client side
    const deviceFingerprint = navigator.userAgent + navigator.language;

    try {
      const res = await fetch("/api/assessment/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          ticketId,
          deviceFingerprint,
        }),
      });

      const data = await res.json();

      if (data.success) {
        localStorage.setItem("user_email", email.toLowerCase());
        localStorage.setItem("user_ticket", ticketId.toUpperCase());
        localStorage.setItem("device_id", data.deviceId);
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

  // Don't render anything until after hydration
  if (!isClient) {
    return (
      <div className="min-h-screen bg-[#E6E6FF] flex items-center justify-center p-4">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-[#0000FF] mx-auto" />
          <p className="mt-4 text-[#0000FF] font-bold">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-5xl w-full">
      {/* Rules Section */}
      <Card className="border-l-8 border-l-[#FFBB00] shadow-xl">
        <CardHeader>
          <CardTitle className="text-[#0000FF] font-black italic">
            RULES OF ENGAGEMENT
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm font-medium text-gray-700">
          <ul className="space-y-2 list-disc pl-4">
            <li>
              60 objective questions in <strong>30 minutes</strong>.
            </li>
            <li>
              3 Theory questions once you pass the objectives{" "}
              <strong>(Max time of 1 hour)</strong>.
            </li>
            <li>
              Multiple device logins will result in{" "}
              <strong>disqualification</strong>.
            </li>
            <li>No copying and pasting allowed.</li>
            <li>
              No use of AI <strong>(monitored)</strong>.
            </li>
            <li>
              Opening new tabs during the assessment will lead to{" "}
              <strong>automatic disqualification.</strong>
            </li>
            <li>
              Ranking is <strong>First Come, First Served</strong>.
            </li>
            <li>
              <strong>80% pass mark </strong> is required for access to the
              theory section.
            </li>
          </ul>
          <div className="pt-4 flex items-center gap-3 bg-blue-50 p-3 rounded-lg border border-blue-100">
            <input
              type="checkbox"
              id="rules"
              checked={acceptedRules}
              onChange={(e) => setAcceptedRules(e.target.checked)}
              className="h-5 w-5 accent-[#0000FF]"
            />
            <label
              htmlFor="rules"
              className="font-bold text-[#0000FF] cursor-pointer"
            >
              I understand and agree to these rules.
            </label>
          </div>
        </CardContent>
      </Card>

      {/* Login Form */}
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
