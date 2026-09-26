import { NextResponse } from "next/server";
import QRCode from "qrcode";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ barcodeId: string }> },
) {
  const { barcodeId } = await params;

  if (!barcodeId) {
    return new NextResponse("Missing barcodeId", { status: 400 });
  }

  const qrBuffer = await QRCode.toBuffer(barcodeId, {
    color: { dark: "#0000FF", light: "#FFFFFF" },
    width: 400,
    margin: 2,
  });

  return new NextResponse(new Uint8Array(qrBuffer), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
