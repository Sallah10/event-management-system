import Link from "next/link";
import { MoveLeft, AlertCircle } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-[#E6E6FF] flex items-center justify-center p-6">
      <div className="text-center space-y-6">
        <div className="flex justify-center">
          <div className="bg-[#0000FF]/10 p-6 rounded-full">
            <AlertCircle className="h-24 w-24 text-[#0000FF]" />
          </div>
        </div>
        <h1 className="text-9xl font-black text-[#0000FF] opacity-20">404</h1>
        <div className="space-y-2">
          <h2 className="text-3xl font-bold text-[#0000FF]">Page Not Found</h2>
          <p className="text-gray-500 font-medium">
            The link you followed might be broken or the page has been moved.
          </p>
        </div>
        <Link
          href="/"
          className="inline-flex items-center gap-2 bg-[#0000FF] text-white px-8 py-3 rounded-full font-bold hover:bg-[#0000CC] transition-all"
        >
          <MoveLeft className="h-5 w-5" /> Back to TechShift
        </Link>
      </div>
    </div>
  );
}
