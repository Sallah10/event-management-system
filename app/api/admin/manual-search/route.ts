import { NextResponse } from "next/server";
import { Registrant } from "@/lib/models/Registrant";
import { Op } from "sequelize";
import { requireStaff } from "@/lib/staff-guard";
import { ensureDatabase } from "@/lib/db";
import { cleanText } from "@/lib/validate";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";

// ─── REGISTRANT SEARCH (desk) ─────────────────────────────────────────────────
// Used by the manual check-in desk to find a candidate who can't scan.
//
// `Op.iLike: '%' + q + '%'` with a 2-character minimum, unescaped, and no rate
// limit - so a staff session holder could walk the entire registrant table two
// characters at a time and harvest every name, email and barcode. Fixed by
// escaping the LIKE metacharacters the user actually typed, raising the floor to
// 3 characters, and leaning on the proxy's staff rate limit.
//
// Note the LIKE escape is the point: a search for "%" should search for a literal
// per cent sign, not match every row.
export async function GET(request: Request) {
  const { error } = await requireStaff("staff");
  if (error) return error;

  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("q") ?? "";
  const q = cleanText(raw, 80);

  if (q.length < 3) {
    return NextResponse.json(
      {
        success: false,
        error: "QUERY_TOO_SHORT",
        message: "Enter at least 3 characters.",
      },
      { status: 400 },
    );
  }

  // Escape %, _ and \ so a user searching for "50%" doesn't match everything
  const escaped = q.replace(/[\\%_]/g, (char) => `\\${char}`);
  const pattern = `%${escaped}%`;

  try {
    await ensureDatabase();

    const results = await Registrant.findAll({
      where: {
        [Op.or]: [
          { name: { [Op.iLike]: pattern } },
          { email: { [Op.iLike]: pattern } },
          { barcodeId: { [Op.iLike]: pattern } },
        ],
      },
      attributes: [
        "id",
        "name",
        "email",
        "barcodeId",
        "checkedIn",
        "status",
        "selectedCourseSlug",
      ],
      limit: 10,
      raw: true,
    });

    log.info("admin.search", { results: results.length });

    return NextResponse.json({
      success: true,
      error: null,
      data: { results, query: q },
    });
  } catch {
    return NextResponse.json(
      { success: false, error: "UNAVAILABLE", message: "Search unavailable." },
      { status: 503 },
    );
  }
}
