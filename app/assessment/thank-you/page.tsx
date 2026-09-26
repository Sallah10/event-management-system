"use client";

import {
  CheckCircle2,
  Globe,
  Instagram,
  Twitter,
  Facebook,
  Linkedin,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { motion } from "framer-motion";

const SOCIALS = [
  {
    name: "Instagram",
    url: "https://www.instagram.com/1techacademy_ng/",
    icon: <Instagram />,
  },
  {
    name: "Facebook",
    url: "https://www.facebook.com/people/1Tech-Academy/61573710158376/",
    icon: <Facebook />,
  },
  {
    name: "LinkedIn",
    url: "https://www.linkedin.com/company/1tech-academy/",
    icon: <Linkedin />,
  },
  { name: "Twitter", url: "https://x.com/1techAcademy", icon: <Twitter /> },
];

export default function ThankYouPage() {
  return (
    <div className="min-h-screen bg-[#E6E6FF] flex items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-xl"
      >
        <Card className="border-none shadow-[0_40px_80px_rgba(0,0,255,0.15)] overflow-hidden rounded-[48px]">
          <div className="bg-[#0000FF] p-16 text-center text-white -mt-10 relative">
            <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none">
              <div className="absolute top-10 left-10 w-20 h-20 border-8 border-white rounded-full"></div>
              <div className="absolute bottom-10 right-10 w-20 h-20 border-8 border-[#FFBB00] rotate-45"></div>
            </div>
            <div className="flex justify-center mb-6">
              <div className="bg-[#FFBB00] p-6 rounded-full shadow-[0_0_50px_rgba(255,187,0,0.6)] animate-pulse">
                <CheckCircle2
                  className="h-16 w-16 text-[#0000FF]"
                  strokeWidth={3}
                />
              </div>
            </div>
            <h1 className="text-4xl font-black italic tracking-tighter uppercase leading-none">
              Application Complete
            </h1>
            <p className="text-blue-100 mt-4 font-bold uppercase text-[10px] tracking-[0.3em]">
              TechShift 2026 Summit
            </p>
          </div>

          <CardContent className="p-12 text-center space-y-10 bg-white">
            <div className="space-y-4">
              <h3 className="text-2xl font-black text-gray-900 italic">
                WHAT HAPPENS NEXT?
              </h3>
              <p className="text-gray-500 font-medium text-lg leading-relaxed">
                Successful candidates will be reached via email and on our
                social media platforms. All the best!
              </p>
            </div>

            <div className="pt-8 border-t border-gray-100">
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-6">
                Follow the movement
              </p>
              <div className="flex justify-center gap-5">
                {SOCIALS.map((social) => (
                  <a
                    key={social.name}
                    href={social.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bg-slate-50 p-4 rounded-2xl text-[#0000FF] hover:bg-[#0000FF] hover:text-white hover:-translate-y-2 transition-all shadow-sm"
                  >
                    {social.icon}
                  </a>
                ))}
              </div>
            </div>

            <button
              onClick={() =>
                (window.location.href = "https://techshift.africa")
              }
              className="w-full py-5 text-[#0000FF] font-black uppercase text-sm border-2 border-[#0000FF] rounded-2xl hover:bg-[#0000FF] hover:text-white transition-all shadow-xl"
            >
              Return to TechShift Homepage
            </button>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
