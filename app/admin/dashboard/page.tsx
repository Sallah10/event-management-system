"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Users,
  CheckCircle2,
  Zap,
  Search,
  Loader2,
  RefreshCcw,
} from "lucide-react";
import { toast } from "sonner";

export default function StaffDashboard() {
  const [stats, setStats] = useState({ total: 0, checkedIn: 0, qualified: 0 });
  const [recent, setRecent] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [isAuditing, setIsAuditing] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/stats", {
        headers: {
          // Use the same key you defined in your .env
          "x-api-key": process.env.NEXT_PUBLIC_INTERNAL_API_KEY || "",
        },
      });

      if (res.status === 401) {
        toast.error("Dashboard Access Denied: Invalid API Key");
        return;
      }

      const data = await res.json();
      if (data.success) {
        setStats(data.summary);
        setRecent(data.recent);
      }
    } catch (err) {
      toast.error("Failed to connect to Command Center");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    fetchData();
  }, []);

  // const runAudit = async () => {
  //   setIsAuditing(true);
  //   const res = await fetch("/api/admin/ai-audit", { method: "POST" });
  //   const data = await res.json();
  //   setIsAuditing(false);
  //   toast.success(`AI Processed ${data.count} candidates`);
  //   fetchData();
  // };

  const runAudit = async () => {
    toast("Run AI Vetting?", {
      description: "This will submit 910 essays to OpenAI Batch API (~$0.18).",
      action: {
        label: "Confirm",
        onClick: async () => {
          setIsAuditing(true);
          try {
            const res = await fetch("/api/admin/ai-audit", {
              method: "POST",
              headers: {
                "x-api-key": process.env.NEXT_PUBLIC_ADMIN_SECRET!,
              },
            });
            const data = await res.json();

            if (!data.success) {
              toast.error(data.error || "Batch submission failed.");
              return;
            }

            // Save batch_id to localStorage so you can collect results later
            localStorage.setItem("ai_batch_id", data.batch_id);

            toast.success(
              `Batch submitted! ${data.candidate_count} candidates queued. Est. cost: ${data.cost_estimate}`,
              { duration: 8000 },
            );
          } catch (e) {
            toast.error("Audit failed. Check API logs.");
          } finally {
            setIsAuditing(false);
          }
        },
      },
    });
  };

  // Separate function to collect results once batch is done
  const collectResults = async () => {
    const batchId = localStorage.getItem("ai_batch_id");
    if (!batchId) {
      toast.error("No batch job found. Run the audit first.");
      return;
    }

    setIsAuditing(true);
    try {
      const res = await fetch(`/api/admin/ai-audit?batch_id=${batchId}`, {
        headers: { "x-api-key": process.env.NEXT_PUBLIC_ADMIN_SECRET! },
      });
      const data = await res.json();

      if (data.status !== "completed") {
        toast.info(
          `Batch still processing (${data.status}). Check back later.`,
        );
        return;
      }

      // Clear batch_id once collected
      localStorage.removeItem("ai_batch_id");
      toast.success(`Done! ${data.graded} candidates graded.`);
      fetchData();
    } catch (e) {
      toast.error("Failed to collect results.");
    } finally {
      setIsAuditing(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        <div className="flex flex-col md:flex-row gap-4 md:gap-0 justify-between items-center">
          <h1 className="text-4xl font-black text-[#0000FF] italic tracking-tighter">
            EVENT COMMAND
          </h1>
          <div className="flex gap-3">
            <button
              onClick={fetchData}
              className="p-3 bg-white rounded-xl shadow-sm hover:rotate-180 transition-all duration-500 cursor-pointer"
            >
              <RefreshCcw size={20} className="text-blue-600" />
            </button>
            <button
              onClick={runAudit}
              disabled={isAuditing}
              className="bg-[#0000FF] text-[#FFBB00] text-sm px-3 py-3 rounded-xl font-black flex items-center gap-2 disabled:opacity-50 hover:bg-blue-800 transition-all cursor-pointer"
            >
              {isAuditing ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Zap size={18} fill="#FFBB00" />
              )}
              AI AUDIT BATCH
            </button>
            <button
              onClick={collectResults}
              disabled={isAuditing}
              className="text-sm bg-[#FFBB00] text-white px-3 py-3 rounded-xl font-black flex items-center gap-2 disabled:opacity-50 hover:bg-yellow-600 transition-all cursor-pointer"
            >
              Collect Results
            </button>
          </div>
          <a
            href="/checkin"
            className="bg-white text-gray-500 px-6 py-3 rounded-xl font-black shadow-sm hover:shadow-md hover:text-gray-950 transition-all"
          >
            CheckIn
          </a>
          <a
            href="/admin/manual-checkin"
            className="bg-yellow-100 text-[#0000FF] px-6 py-3 rounded-xl font-black shadow-sm hover:shadow-md hover:bg-yellow-300 transition-all"
          >
            Manual CheckIn
          </a>
        </div>

        {/* Stats Section */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <MetricCard title="REGISTRANTS" value={stats.total} />
          <MetricCard
            title="CHECKED IN"
            value={`${stats.checkedIn} / 3500`}
            highlight={stats.checkedIn >= 3500}
          />
          <MetricCard title="QUALIFIED (910)" value={stats.qualified} />
        </div>

        {/* Search & List */}
        <Card className="border-none shadow-2xl rounded-[30px] overflow-hidden">
          <div className="p-6 bg-white border-b flex justify-between items-center">
            <div className="relative w-full max-w-md">
              <Search
                className="absolute left-4 top-3.5 text-gray-400"
                size={18}
              />
              <input
                placeholder="Search attendee name or email..."
                className="w-full pl-12 pr-4 py-3 bg-gray-50 rounded-2xl outline-none focus:ring-2 ring-blue-100 transition-all"
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-gray-50 text-[10px] font-black text-gray-400 uppercase tracking-widest">
                  <tr>
                    <th className="p-6">Attendee</th>
                    <th className="p-6">Barcode Id</th>
                    <th className="p-6 text-right">Activity</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {recent
                    .filter((r) =>
                      r.name.toLowerCase().includes(search.toLowerCase()),
                    )
                    .map((r, i) => (
                      <tr
                        key={i}
                        className="hover:bg-blue-50/30 transition-colors"
                      >
                        <td className="p-6">
                          <p className="font-bold text-gray-900">{r.name}</p>
                          <p className="text-xs text-gray-500">{r.email}</p>
                        </td>
                        <td className="p-6">
                          <span className="bg-blue-50 text-[#0000FF] px-3 py-1 rounded-full text-[10px] font-black uppercase">
                            {/* {r.selectedCourseSlug || "N/A"} */}
                            {r.barcodeId || "N/A"}
                          </span>
                        </td>
                        <td className="p-6 text-right font-mono text-xs text-gray-400">
                          {new Date(r.updatedAt).toLocaleTimeString()}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MetricCard({ title, value, highlight }: any) {
  return (
    <Card
      className={`border-none shadow-lg rounded-[25px] ${highlight ? "bg-red-600 text-white" : "bg-white"}`}
    >
      <CardContent className="p-8">
        <p
          className={`text-xs font-black tracking-[0.2em] mb-2 ${highlight ? "text-white/60" : "text-gray-400"}`}
        >
          {title}
        </p>
        <p className="text-4xl font-black tracking-tighter italic">{value}</p>
      </CardContent>
    </Card>
  );
}
