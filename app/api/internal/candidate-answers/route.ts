// app/api/internal/candidate-answers/route.ts  (Event Portal)
import { NextResponse } from "next/server";
import { Registrant } from "@/lib/models/Registrant";

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.split(" ")[1];

  if (!token || token !== process.env.INTERNAL_SYNC_TOKEN) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const email = searchParams.get("email");

  if (!email) {
    return NextResponse.json({ message: "Email required" }, { status: 400 });
  }

  const registrant = await Registrant.findOne({
    where: { email: email.toLowerCase() },
    attributes: [
      "name",
      "email",
      "theoryAnswer1",
      "theoryAnswer2",
      "theoryAnswer3",
      "selectedCourseSlug",
    ],
    raw: true,
  });

  if (!registrant) {
    return NextResponse.json({ message: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true, data: registrant });
}
