"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Lock, ShieldCheck, Loader2 } from "lucide-react";

export default function AdminLoginPage() {
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const res = await fetch("/api/admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });

      const data = await res.json();
      if (data.success) {
        router.push("/admin/dashboard");
      } else {
        alert("Invalid Staff PIN");
        setLoading(false);
      }
    } catch (error) {
      console.error("Auth error:", error);
      alert("An error occurred. Please try again.");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0000FF] flex items-center justify-center p-4">
      <Card className="w-full max-w-sm border-none shadow-2xl rounded-[30px]">
        <CardHeader className="text-center pt-10">
          <div className="flex justify-center mb-4">
            <div className="bg-[#0000FF] p-4 rounded-2xl shadow-xl">
              <Lock className="text-[#FFBB00]" size={32} />
            </div>
          </div>
          <CardTitle className="text-2xl font-black text-[#0000FF] tracking-tighter italic">
            STAFF ACCESS
          </CardTitle>
        </CardHeader>
        <CardContent className="p-8">
          <form onSubmit={handleAuth} className="space-y-6">
            <input
              type="password"
              placeholder="ENTER ADMIN PIN"
              className="w-full bg-gray-100 border-2 border-transparent focus:border-[#0000FF] p-5 rounded-2xl text-center text-sm font-black tracking-[0.5em] outline-none transition-all"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
            />
            <button
              disabled={loading}
              className="w-full bg-[#0000FF] text-white py-5 rounded-2xl font-black text-lg hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-2"
            >
              {loading ? (
                <Loader2 className="animate-spin" />
              ) : (
                <>
                  <ShieldCheck /> AUTHORIZE SESSION
                </>
              )}
            </button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
