import "server-only";

import { Op, fn, col } from "sequelize";
import { Registrant } from "@/lib/models/Registrant";
import { COURSES } from "@/config/course-matrix";
import { LIMIT_PER_COURSE, SEAT_HOLDING_STATUSES } from "@/config/rules";

// ─── LIVE COURSE AVAILABILITY ─────────────────────────────────────────────────
// Extracted from the course-slots route so the theory page can render the picker
// on the server.
//
// It used to be a client-side fetch, which cost a full round trip after a
// spinner on a page whose whole purpose is a decision — "which of these 13
// tracks still has money in it?" A candidate on a bad connection saw an empty
// list, and the "Full" styling is not a substitute for a real number.
//
// Note what counts as a taken seat: `completed` as well as the seat-holding
// statuses. A candidate who has submitted the theory paper and is awaiting
// grading holds that seat provisionally, and a second candidate must not be told
// the track is open because the first one's essay is still in the grader's
// queue.

export interface CourseAvailability {
  slug: string;
  displayName: string;
  taken: number;
  capacity: number;
  remaining: number;
  isFull: boolean;
}

export async function getCourseAvailability(): Promise<CourseAvailability[]> {
  const slugs = COURSES.map((course) => course.slug);

  const rows = (await Registrant.findAll({
    attributes: ["selectedCourseSlug", [fn("COUNT", col("id")), "taken"]],
    where: {
      // Constrained to canonical slugs, so a junk value can never pollute the
      // group-by and a course can never be counted against a name that does not
      // exist.
      selectedCourseSlug: { [Op.in]: slugs },
      status: { [Op.in]: [...SEAT_HOLDING_STATUSES, "completed"] },
    },
    group: ["selectedCourseSlug"],
    raw: true,
  })) as unknown as { selectedCourseSlug: string; taken: number }[];

  const taken = new Map(
    rows.map((row) => [String(row.selectedCourseSlug), Number(row.taken ?? 0)]),
  );

  return COURSES.map((course) => {
    const used = taken.get(course.slug) ?? 0;
    return {
      slug: course.slug,
      displayName: course.displayName,
      // `lmsId` is deliberately NOT in this payload. It is our internal handle
      // in the third-party LMS — the thing the winners export maps onto — and the
      // course picker has no use for it. The old course-slots route shipped it to
      // any caller, which turned an unauthenticated endpoint into a map of every
      // course in the LMS and how many of our seats each one had left.
      taken: used,
      capacity: LIMIT_PER_COURSE,
      remaining: Math.max(0, LIMIT_PER_COURSE - used),
      isFull: used >= LIMIT_PER_COURSE,
    };
  });
}
