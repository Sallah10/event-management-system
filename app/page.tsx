"use client";

import { motion } from "framer-motion";
import { GraduationCap, ShieldCheck, ArrowRight, Zap } from "lucide-react";
import Link from "next/link";

export default function EntryPortal() {
  return (
    <div className="min-h-screen bg-[#0000FF] flex items-center justify-center p-4 overflow-hidden relative">
      {/* Background Decorative Elements */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-[#FFBB00] rounded-full blur-[150px] opacity-20 animate-pulse"></div>

      <div className="max-w-5xl w-full grid grid-cols-1 md:grid-cols-2 gap-8 z-10">
        {/* STUDENT SIDE */}
        <motion.div
          whileHover={{ y: -10 }}
          className="bg-white rounded-[40px] p-10 flex flex-col justify-between shadow-2xl relative overflow-hidden group"
        >
          <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:opacity-10 transition-opacity">
            <GraduationCap size={180} />
          </div>
          <div>
            <div className="bg-[#0000FF] w-16 h-16 rounded-2xl flex items-center justify-center mb-8 shadow-lg">
              <Zap className="text-[#FFBB00]" size={32} fill="#FFBB00" />
            </div>
            <h2 className="text-4xl font-black text-[#0000FF] tracking-tighter leading-none italic mb-4">
              STUDENT <br />
              ASSESSMENT
            </h2>
            <p className="text-gray-500 font-bold leading-relaxed max-w-62.5">
              Access the 2026 TechShift scholarship examination portal.
            </p>
          </div>
          <Link
            href="/assessment/login"
            className="mt-12 bg-[#FFBB00] text-[#0000FF] py-5 rounded-2xl font-black text-xl flex items-center justify-center gap-3 hover:scale-[1.02] transition-all shadow-[0_10px_20px_rgba(255,187,0,0.3)]"
          >
            ENTER PORTAL <ArrowRight strokeWidth={4} />
          </Link>
        </motion.div>

        {/* STAFF SIDE */}
        <motion.div
          whileHover={{ y: -10 }}
          className="bg-[#E6E6FF]/10 backdrop-blur-xl border-2 border-white/20 rounded-[40px] p-10 flex flex-col justify-between group"
        >
          <div>
            <div className="bg-white/10 w-16 h-16 rounded-2xl flex items-center justify-center mb-8">
              <ShieldCheck className="text-white" size={32} />
            </div>
            <h2 className="text-4xl font-black text-white tracking-tighter leading-none italic mb-4">
              STAFF <br />
              COMMAND
            </h2>
            <p className="text-blue-100/60 font-bold leading-relaxed max-w-62.5">
              Secure login for event management and check-in staff.
            </p>
          </div>
          <Link
            href="/admin/login"
            className="mt-12 border-2 border-white text-white py-5 rounded-2xl font-black text-xl flex items-center justify-center gap-3 hover:bg-white hover:text-[#0000FF] transition-all"
          >
            STAFF LOGIN <ShieldCheck strokeWidth={3} />
          </Link>
        </motion.div>
      </div>
    </div>
  );
}
