import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { STAFF_COOKIE, verifyStaffSession, type StaffRole, type StaffSession } from "@/lib/session";

// ─── STAFF ROUTE GUARDS ───────────────────────────────────────────────────────
// The old pattern, repeated in five files:
//
//     const token = cookieStore.get("staff_access")?.value;
//     if (!token || token !== process.env.STAFF_ACCESS_TOKEN) return 401;
//
// Two problems. First, the cookie VALUE WAS the env var — a long-lived static
// secret sitting in a browser cookie, never rotated, 24h maxAge, so one leaked
// cookie and one leaked env var were the same compromise. Second, there was no
// role separation, so the same cookie opened the check-in scanner, the PII
// search over every registrant, and the endpoint that spends money on grading.
//
// Now the cookie holds a signed, expiring, role-bearing token, and each route
// declares the role it needs.

export async function requireStaff(
  role: StaffRole = "staff",
): Promise<{ session: StaffSession; error?: never } | { session?: never; error: NextResponse }> {
  const store = await cookies();
  const session = await verifyStaffSession(store.get(STAFF_COOKIE)?.value);

  if (!session) {
    return {
      error: NextResponse.json(
        { success: false, error: "UNAUTHORIZED", message: "Staff sign-in required." },
        { status: 401 },
      ),
    };
  }

  // `admissions` is the superset — it can work the door too.
  if (role === "admissions" && session.role !== "admissions") {
    return {
      error: NextResponse.json(
        {
          success: false,
          error: "FORBIDDEN",
          message: "This area is restricted to admissions staff.",
        },
        { status: 403 },
      ),
    };
  }

  return { session };
}
