import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(request: Request) {
  try {
    // Optional: Verify user is logged in
    const cookieStore = await cookies();
    const authToken = cookieStore.get("auth_token")?.value;

    if (!authToken) {
      // Still allow reporting but log as anonymous
      console.log("⚠️ Unauthenticated issue report");
    }

    const { email, ticketId, issue, description, url, timestamp } =
      await request.json();

    if (!email || !issue) {
      return NextResponse.json(
        { success: false, message: "Missing required fields" },
        { status: 400 },
      );
    }

    // Map issue codes to readable labels
    const issueLabels: Record<string, string> = {
      back_button: "Accidental back button",
      tab_switch: "Accidental tab switch",
      window_resize: "Window resize",
      browser_crash: "Browser crash",
      network: "Network disconnection",
      other: "Other issue",
    };

    // Send email to support team
    await resend.emails.send({
      from: "TechShift Support <techshift@mail.1techacademy.com>",
      to: ["support@1techacademy.com"],
      subject: `🆘 Technical Issue Report - ${ticketId || "No Ticket ID"}`,
      html: `
        <h2 style="color: #0000FF;">Technical Issue Reported</h2>
        
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
           <tr>
            <td style="padding: 10px; background: #f0f0f0; font-weight: bold;">Email:</td>
            <td style="padding: 10px;">${email || "Not provided"}</td>
           </tr>
           <tr>
            <td style="padding: 10px; background: #f0f0f0; font-weight: bold;">Ticket ID:</td>
            <td style="padding: 10px;">${ticketId || "Not provided"}</td>
           </tr>
           <tr>
            <td style="padding: 10px; background: #f0f0f0; font-weight: bold;">Issue Type:</td>
            <td style="padding: 10px;">${issueLabels[issue] || issue}</td>
           </tr>
           <tr>
            <td style="padding: 10px; background: #f0f0f0; font-weight: bold;">Description:</td>
            <td style="padding: 10px;">${description || "No description"}</td>
           </tr>
           <tr>
            <td style="padding: 10px; background: #f0f0f0; font-weight: bold;">URL:</td>
            <td style="padding: 10px;">${url || "Unknown"}</td>
           </tr>
           <tr>
            <td style="padding: 10px; background: #f0f0f0; font-weight: bold;">Time:</td>
            <td style="padding: 10px;">${new Date(timestamp).toLocaleString()}</td>
           </tr>
         </table>
        
        <hr style="border: 1px solid #eee;" />
        
        <p style="color: #666; font-size: 12px;">
          This is an automated report from the TechShift assessment platform.
        </p>
      `,
    });

    console.log(`🆘 Issue reported: ${email} — ${issueLabels[issue] || issue}`);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Report issue error:", error);
    return NextResponse.json(
      { success: false, message: "Failed to report issue" },
      { status: 500 },
    );
  }
}
