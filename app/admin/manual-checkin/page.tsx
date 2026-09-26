"use client";

import { useState, useEffect, useCallback } from "react";
import { Search, CheckCircle, AlertTriangle, Loader2 } from "lucide-react";

export default function ManualCheckinPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [checkedIn, setCheckedIn] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [hasSearched, setHasSearched] = useState(false);

  const search = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setResults([]);
      setError("");
      setHasSearched(false);
      return;
    }

    setSearching(true);
    setError("");

    try {
      const res = await fetch(
        `/api/admin/manual-search?q=${encodeURIComponent(q.trim())}`,
      );

      if (res.status === 401) {
        setError("Not authorized. Please log into the admin panel first.");
        setSearching(false);
        return;
      }

      const data = await res.json();
      setHasSearched(true);

      if (data.success) {
        setResults(data.results);
        setError("");
      } else {
        setError(data.message || "Search failed.");
        setResults([]);
      }
    } catch (e) {
      setError("Connection error. Try again.");
      setResults([]);
    }

    setSearching(false);
  }, []);

  // Debounce — waits 400ms after user stops typing before searching
  useEffect(() => {
    const timer = setTimeout(() => {
      search(query);
    }, 400);

    return () => clearTimeout(timer);
  }, [query, search]);

  const checkIn = async (barcodeId: string) => {
    setError("");
    const res = await fetch("/api/check-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ barcodeId }),
    });
    const data = await res.json();

    if (data.success) {
      setCheckedIn(barcodeId);
      setResults((prev) =>
        prev.map((r) =>
          r.barcodeId === barcodeId ? { ...r, checkedIn: true } : r,
        ),
      );
    } else {
      setError(data.message);
    }
  };

  return (
    <div className="min-h-screen bg-[#E6E6FF] flex flex-col items-center justify-start p-6 pt-16">
      <div className="w-full max-w-xl space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-black text-[#0000FF]">
            MANUAL CHECK-IN
          </h1>
          <p className="text-sm text-gray-500 font-medium mt-1">
            Search by name, email, or ticket ID
          </p>
        </div>

        {/* Search input — no button needed, live search */}
        <div className="relative">
          <Search className="absolute left-4 top-3.5 h-5 w-5 text-gray-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type name, email or ticket ID..."
            className="w-full pl-12 pr-4 py-3 rounded-xl border-2 border-white focus:border-[#0000FF] outline-none font-medium"
          />
          {searching && (
            <Loader2 className="absolute right-4 top-3.5 h-5 w-5 text-[#0000FF] animate-spin" />
          )}
        </div>

        {error && (
          <div className="bg-red-50 text-red-600 p-3 rounded-xl flex items-center gap-2 font-bold text-sm border border-red-100">
            <AlertTriangle className="h-4 w-4" /> {error}
          </div>
        )}

        <div className="space-y-3">
          {results.map((r) => (
            <div
              key={r.barcodeId}
              className="bg-white rounded-2xl p-4 shadow flex items-center justify-between"
            >
              <div>
                <p className="font-black text-[#0000FF]">{r.name}</p>
                <p className="text-xs text-gray-500">{r.email}</p>
                <p className="text-xs font-mono text-gray-400 mt-1">
                  {r.barcodeId}
                </p>
                <span
                  className={`text-xs font-bold mt-1 inline-block ${
                    r.checkedIn ? "text-green-600" : "text-orange-500"
                  }`}
                >
                  {r.checkedIn ? "Already checked in" : "Not checked in"}
                </span>
              </div>
              <div>
                {r.checkedIn || checkedIn === r.barcodeId ? (
                  <span className="flex items-center gap-1 text-green-600 font-bold text-sm">
                    <CheckCircle className="h-4 w-4" /> Done
                  </span>
                ) : (
                  <button
                    onClick={() => checkIn(r.barcodeId)}
                    className="bg-[#FFBB00] text-[#0000FF] px-4 py-2 rounded-xl font-black text-sm hover:scale-105 transition-all"
                  >
                    CHECK IN
                  </button>
                )}
              </div>
            </div>
          ))}

          {/* Only show "no results" after a completed search, not while typing */}
          {hasSearched &&
            !searching &&
            results.length === 0 &&
            query.length >= 2 &&
            !error && (
              <p className="text-center text-gray-400 font-medium py-8">
                No results found for "{query}"
              </p>
            )}

          {query.length < 2 && (
            <p className="text-center text-gray-400 font-medium py-8">
              Type at least 2 characters to search
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
