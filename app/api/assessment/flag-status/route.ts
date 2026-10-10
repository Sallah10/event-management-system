import { NextResponse } from "next/server";
import { Registrant } from "@/lib/models/Registrant";
import { ensureDatabase } from "@/lib/db";
import { requireCandidate } from "@/lib/auth";
import { redis, flagKey } from "@/lib/redis";

export const dynamic = "force-dynamic";

// ─── FLAG STATUS ──────────────────────────────────────────────────────────────
// Polled by the exam and theory pages to show the warning ladder.
//
// The old version decoded the JWT inline with `jsonwebtoken` and a HARDCODED
// fallback secret, `"your-secret-key-change-this"` - a different literal from the
// `"jwt_secret_key"` used by /flag and /start-exam, and different again from
// lib/auth.ts, which had no fallback at all. Six files, four behaviours. If
// JWT_SECRET was ever absent from the deployed env, this route would have
// happily accepted tokens signed with a string published in the repository.
//
// Now it verifies through the same lib/session.ts the proxy uses, so there is one
// implementation and one secret, and a missing secret is a loud startup failure
// rather than a silent acceptance.
export async function GET(request: Request) {
  const { session, error } = await requireCandidate(request);
  if (error) return error;

  try {
    await ensureDatabase();

    const student = await Registrant.findOne({
      where: { barcodeId: session.barcodeId },
      attributes: ["isFlagged", "status"],
    });

    if (!student) {
      return NextResponse.json(
        {
          success: false,
          error: "INVALID_SESSION",
          message: "Invalid session.",
        },
        { status: 403 },
      );
    }

    const count = Number((await redis.get(flagKey(session.barcodeId))) ?? 0);

    return NextResponse.json({
      success: true,
      error: null,
      flagCount: count,
      isFlagged: student.isFlagged,
      status: student.status,
    });
  } catch {
    // Deliberately quiet: this is polled every few seconds by two pages, and a
    // transient DB blip should degrade the warning ladder, not spam the logs.
    return NextResponse.json(
      { success: false, error: "UNAVAILABLE", message: "Status unavailable." },
      { status: 503 },
    );
  }
}
