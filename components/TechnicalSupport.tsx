"use client";

import { useState } from "react";
import { toast } from "sonner";
import { AlertCircle, X } from "lucide-react";

interface TechnicalSupportProps {
  email: string | null;
  ticketId: string | null;
}

export default function TechnicalSupport({
  email,
  ticketId,
}: TechnicalSupportProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [issue, setIssue] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const issues = [
    { value: "back_button", label: "Accidentally pressed back button" },
    { value: "tab_switch", label: "Accidentally switched tabs" },
    { value: "window_resize", label: "Window resized automatically" },
    { value: "browser_crash", label: "Browser/App crashed" },
    { value: "network", label: "Network disconnection" },
    { value: "other", label: "Other issue" },
  ];

  const handleSubmit = async () => {
    if (!issue) {
      toast.error("Please select an issue type");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/assessment/report-issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          ticketId,
          issue,
          description,
          url: window.location.href,
          timestamp: new Date().toISOString(),
        }),
      });

      const data = await res.json();

      if (data.success) {
        toast.success("✅ Issue reported. Our support team will review.", {
          duration: 5000,
        });
        setIsOpen(false);
        setIssue("");
        setDescription("");
      } else {
        toast.error(
          "Failed to submit. Please email support@1techacdemy.com with your issue and ticket ID.",
        );
      }
    } catch (error) {
      toast.error("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 right-4 bg-[#0000FF] text-white p-3 rounded-full shadow-lg hover:bg-[#0000CC] transition-all z-50"
        title="Report technical issue"
      >
        🆘
      </button>

      {/* Modal */}
      {isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-100 p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl">
            <div className="p-6 border-b flex justify-between items-center">
              <h3 className="text-xl font-black text-[#0000FF]">
                Report Technical Issue
              </h3>
              <button
                onClick={() => setIsOpen(false)}
                className="p-2 hover:bg-gray-100 rounded-full"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-blue-50 p-3 rounded-lg flex items-start gap-2">
                <AlertCircle className="h-5 w-5 text-[#0000FF] shrink-0 mt-0.5" />
                <p className="text-xs text-[#0000FF]">
                  Reporting an issue will not automatically flag your account.
                  Our team will review and help resolve your problem.
                </p>
              </div>

              <div>
                <label className="text-xs font-bold text-gray-500 uppercase">
                  Issue Type *
                </label>
                <select
                  value={issue}
                  onChange={(e) => setIssue(e.target.value)}
                  className="w-full mt-1 p-3 border-2 rounded-xl focus:border-[#0000FF] outline-none"
                >
                  <option value="">Select an issue...</option>
                  {issues.map((i) => (
                    <option key={i.value} value={i.value}>
                      {i.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-gray-500 uppercase">
                  Description (Optional)
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Tell us more about what happened..."
                  rows={3}
                  className="w-full mt-1 p-3 border-2 rounded-xl focus:border-[#0000FF] outline-none resize-none"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => setIsOpen(false)}
                  className="flex-1 py-3 border-2 rounded-xl font-bold hover:bg-gray-50 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={!issue || submitting}
                  className="flex-1 py-3 bg-[#0000FF] text-white rounded-xl font-bold hover:bg-[#0000CC] transition-all disabled:opacity-50"
                >
                  {submitting ? "Submitting..." : "Report Issue"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
