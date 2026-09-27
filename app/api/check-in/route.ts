import { NextResponse } from "next/server";
import { Registrant } from "@/lib/models/Registrant";
import { ensureDatabase } from "@/lib/db";
import { redis, checkinKey, capacityKey } from "@/lib/redis";
import { requireStaff } from "@/lib/staff-guard";
import { logMetrics } from "@/lib/logger";
import { VENUE_CAPACITY } from "@/config/rules";
import { normaliseTicket } from "@/lib/tickets";

export const dynamic = "force-dynamic";

// ─── CHECK-IN ─────────────────────────────────────────────────────────────────
// Four real problems fixed here:
//
// 1. IT HAD NO AUTHENTICATION AT ALL.
//    The proxy gated the /checkin *page*, but this route lives under /api, and
//    the proxy's staff check tested `path.startsWith("/admin")`. So anyone could
//    POST a barcode and check a real person into the venue — and the response
//    handed back their full name, which made the endpoint a name-enumeration
//    oracle for the whole attendee list.
//
// 2. THE FUZZY MATCHER WAS A LIKE INJECTION.
//    Strategies 2, 4 and 5 built `Op.iLike` patterns out of the scanned string.
//    Two of them only stripped hyphens, so `%` and `_` survived into the SQL.
//    Scanning "TS26-%%%" (8 chars, passes the length guard) produced
//    `ILIKE '%TS26%%%'`, which matches the first TS26 registrant in the table.
//    One scan, one arbitrary check-in. Now: exact match on a normalised ticket,
//    or nothing.
//
// 3. A DATABASE TRANSACTION WAS OPENED BEFORE ANY VALIDATION.
//    `sequelize.transaction()` ran first thing, then up to 5 sequential SELECTs
//    inside it, then a rollback on every early return — against a pool capped at
//    5 connections, with 3,500 people queuing at a door. The transaction bought
//    us nothing: the only write is a single conditional UPDATE, which is already
//    atomic. It's gone.
//
// 4. THE DOOR COULD BE OVERSOLD.
//    The old capacity check read the counter and then, several awaits later,
//    incremented it:
//
//        const counted = Number(await redis.get(capacityKey()));
//        if (counted >= VENUE_CAPACITY) return 409;
//        ... findOne, update, logging, three more round-trips ...
//        const now = Number(await redis.incr(capacityKey()));
//
//    Every one of those awaits is a scheduling point. N scanners all read 3,499,
//    all pass, all increment, and the venue is over capacity by however many
//    were in flight. It is now a single atomic INCR *before* the write, with a
//    compensating DECR if the turn-out. Claiming the slot first is what makes it
//    a gate rather than a race; the counter is still advisory for reporting,
//    which is why /api/admin/stats reports attendance from Postgres.

export async function POST(request: Request) {
  const route = "checkin";

  try {
    // ─── 1. AUTH ─────────────────────────────────────────────────────────────
    // Read from the cookie jar via next/headers, not `request.cookies` — this
    // handler takes a plain `Request`, and NextRequest.cookies only exists on
    // NextRequest. The original `request.cookies.get(...)` would have thrown a
    // TypeError on every call, which the catch turned into a 500.
    const { session: staff, error } = await requireStaff("staff");
    if (error) return error;

    // ─── 2. PARSE + NORMALISE ────────────────────────────────────────────────
    let body: { barcodeId?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: "BAD_REQUEST", message: "Invalid JSON body." },
        { status: 400 },
      );
    }

    const ticket = normaliseTicket(body.barcodeId);
    if (!ticket.ok) {
      return NextResponse.json(
        { success: false, error: "BAD_REQUEST", message: ticket.reason },
        { status: 400 },
      );
    }

    await ensureDatabase();

    // ─── 3. FAST PATH — already checked in (cached) ─────────────────────────
    if (await redis.get(checkinKey(ticket.value))) {
      logMetrics.checkin(ticket.value, "duplicate_cached");
      return NextResponse.json(
        {
          success: false,
          error: "ALREADY_CHECKED_IN",
          message: "ALREADY CHECKED IN",
          details: "This ticket was already scanned at the venue.",
        },
        { status: 409 },
      );
    }

    // ─── 4. CLAIM A VENUE SLOT (atomic) ─────────────────────────────────────
    // INCR first, then check. A read-then-write gate has a window the size of
    // every await between the two halves; INCR has none.
    const claimed = Number((await redis.incr(capacityKey())) ?? 0);
    if (claimed > VENUE_CAPACITY) {
      // Give the slot straight back. Best-effort: if this process dies here the
      // counter sits one high, which is why stats never treat it as truth.
      await redis.decr(capacityKey());
      logMetrics.capacity(claimed - 1, VENUE_CAPACITY);
      return NextResponse.json(
        {
          success: false,
          error: "VENUE_FULL",
          message: "VENUE FULL",
          details: `Capacity of ${VENUE_CAPACITY} reached. Direct the candidate to the overflow desk.`,
        },
        { status: 409 },
      );
    }

    const releaseSlot = async () => {
      await redis.decr(capacityKey());
    };

    // ─── 5. RESOLVE THE TICKET ───────────────────────────────────────────────
    // Normalised, exact-matched candidates only. See normaliseTicket() for why
    // the old five-strategy ILIKE search was removed rather than patched.
    const student = await Registrant.findOne({
      where: { barcodeId: ticket.value },
      attributes: ["id", "name", "barcodeId", "checkedIn", "selectedCourseSlug"],
    });

    if (!student) {
      await releaseSlot();
      logMetrics.checkin(ticket.value, "not_found");
      return NextResponse.json(
        {
          success: false,
          error: "TICKET_NOT_FOUND",
          message: "TICKET NOT FOUND",
          details: "This code is not registered. Send the candidate to the manual desk.",
        },
        { status: 404 },
      );
    }

    if (student.checkedIn) {
      await releaseSlot();
      // Cache under the CANONICAL ticket, not the scanned string — the old code
      // cached under the scan, so a second scan in a different format missed the
      // cache and hit the database every time.
      await redis.set(checkinKey(student.barcodeId), true, { ex: 86_400 });
      logMetrics.checkin(student.barcodeId, "duplicate");
      return NextResponse.json(
        {
          success: false,
          error: "ALREADY_CHECKED_IN",
          message: "ALREADY CHECKED IN",
          details: `${student.name} was already checked in earlier today.`,
        },
        { status: 409 },
      );
    }

    // ─── 6. ATOMIC CLAIM ─────────────────────────────────────────────────────
    // Single conditional UPDATE. `checkedIn: false` in the WHERE clause means two
    // scanners firing at the same instant cannot both win — the loser gets
    // updatedCount 0. No transaction, no SELECT-then-UPDATE race.
    const [claimedRows] = await Registrant.update(
      { checkedIn: true, status: "attended" },
      { where: { id: student.id, checkedIn: false } },
    );

    if (claimedRows === 0) {
      await releaseSlot();
      await redis.set(checkinKey(student.barcodeId), true, { ex: 86_400 });
      logMetrics.checkin(student.barcodeId, "lost_race");
      return NextResponse.json(
        {
          success: false,
          error: "ALREADY_CHECKED_IN",
          message: "ALREADY CHECKED IN",
          details: `${student.name} was checked in a moment ago.`,
        },
        { status: 409 },
      );
    }

    // ─── 7. CONFIRM ──────────────────────────────────────────────────────────
    await redis.set(checkinKey(student.barcodeId), true, { ex: 86_400 });
    logMetrics.capacity(claimed, VENUE_CAPACITY);
    logMetrics.checkin(student.barcodeId, "success", { by: staff.name });

    return NextResponse.json({
      success: true,
      error: null,
      message: `Welcome, ${student.name}!`,
      data: {
        name: student.name,
        // A slug, not a label. The old response called this field `course` and
        // put the slug in it, so the check-in desk rendered
        // "aws-certified-cloud-practitioner-13" on the one screen a human reads
        // out loud. The client maps it to a display name.
        courseSlug: student.selectedCourseSlug ?? null,
        venueCount: claimed,
        venueCapacity: VENUE_CAPACITY,
      },
    });
  } catch (error) {
    logMetrics.routeError(route, error);
    return NextResponse.json(
      { success: false, error: "SERVER_ERROR", message: "Server error. Please try again." },
      { status: 500 },
    );
  }
}
