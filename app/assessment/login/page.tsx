import { Suspense } from "react";
import LoginForm from "@/components/LoginForm";

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-[#E6E6FF] flex items-center justify-center p-4">
      <Suspense
        fallback={
          <div className="text-center">
            <div className="animate-spin h-8 w-8 border-4 border-[#0000FF] border-t-transparent rounded-full mx-auto"></div>
            <p className="mt-4 text-[#0000FF] font-bold">
              Loading login page...
            </p>
          </div>
        }
      >
        <LoginForm />
      </Suspense>
    </div>
  );
}
