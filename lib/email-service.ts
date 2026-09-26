import { Resend } from "resend";
import QRCode from "qrcode";

const resend = new Resend(process.env.RESEND_API_KEY);

export const sendEntranceTicket = async (registrant: any) => {
  // 1. Ensure barcodeId exists! Fallback to a random one if it's missing from your WP Payload
  const barcodeId =
    registrant.barcodeId || `TS2026-${Math.floor(Math.random() * 100000)}`;

  // 2. Generate QR Code buffer directly in memory
  const qrBuffer = await QRCode.toBuffer(barcodeId, {
    color: { dark: "#0000FF", light: "#FFFFFF" },
    width: 400,
    margin: 2,
  });

  const result = await resend.emails.send({
    from: "TechShift 2026 <techshift@mail.1techacademy.com>",
    to: registrant.email,
    subject: "Hi " + registrant.name.split(" ")[0] + ", You're In! 🎟️",
    html: `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: auto; border: 1px solid #e0e0e0; border-radius: 16px; overflow: hidden; color: #333; line-height: 1.6;">
        
        <!-- Header -->
        <div style="background: #0000FF; color: #fff; padding: 40px 20px; text-align: center;">
          <h1 style="margin: 0; font-size: 28px; letter-spacing: -1px;">TechShift 2026</h1>
          <p style="margin-top: 10px; opacity: 0.9; font-weight: bold; text-transform: uppercase; font-size: 12px; letter-spacing: 2px;">Official Entrance Ticket</p>
        </div>

        <div style="padding: 40px;">
          <h2 style="color: #0000FF; margin-top: 0;">Hi ${registrant.name.split(" ")[0]}, You’re In!</h2>
          
          <p>Congratulations! Your seat at the <strong>TechShift 2026 Summit</strong> is officially reserved for <strong>April 18th</strong> at the <strong>Sheraton Balmoral, Lagos</strong>.</p>

          <p>By registering, you have taken the first step toward joining the 3,500 attendees of TechShift and also being a part of the <strong>546 scholarships</strong> available.</p>

          <div style="background: #FFFBEB; border: 2px dashed #FFBB00; border-radius: 12px; padding: 30px; text-align: center; margin: 30px 0;">
             <p style="margin-top: 0; font-weight: bold; color: #854D0E;">YOUR UNIQUE ENTRANCE CODE</p>
             
             <img src="cid:qr-code" width="200" height="200" style="display: block; margin: 0 auto 15px;" alt="Entrance QR Code" />
             
             <div style="background: #0000FF; color: #fff; display: inline-block; padding: 8px 20px; border-radius: 8px; font-family: monospace; font-size: 20px; font-weight: bold;">
               ${registrant.barcodeId}
             </div>
             <p style="font-size: 12px; color: #666; margin-top: 15px;">Present this QR code for physical check-in at the venue.</p>
              <div style="font-size: 13px; color: #333; font-weight: bold; margin-top: 15px;">Note: This QR code is your digital pass and will be scanned at the entrance to grant you access to the venue.</div>
          </div>

          <!-- FIXED: This section was previously outside the main container -->
          <h3 style="color: #0000FF;">Prepare for the Scholarship</h3>
          <p>To qualify for the <strong>₦505 Million Scholarship Fund</strong>, you must complete the digital assessment. Use your unique access code above to log in when the portal opens.</p>

          <div style="background: #F8FAFC; border-left: 4px solid #0000FF; padding: 20px; margin: 20px 0;">
            <p style="margin: 0;"><strong>TechShift Event:</strong> April 18th</p>
            <p style="margin: 5px 0 0; font-size: 14px; color: #64748B;">You must be physically present at the Sheraton Balmoral to activate your scholarship eligibility. <strong>No attendance, no scholarship.</strong></p>
          </div>

          <p>The Digital Assessment portal opening will be announced at the event.</p>

          <p>Between now and April 18th, stay tuned to our social media channels and emails. Your future is no longer a dream; it is a scheduled event.</p>

          <p>We will see you at TechShift 2026.</p>

          <hr style="border: 0; border-top: 1px solid #eee; margin: 30px 0;" />
          
          <p style="font-size: 14px; color: #999; text-align: center;">
            <strong>The TechShift 2026 Team</strong><br/>
            1Tech Academy | Making Life Possible
          </p>
        </div>
      </div>
    `,
    // 3. Pass the Buffer as an attachment, but use content_id so it stays inline!
    attachments: [
      {
        filename: "qrcode.png",
        content: qrBuffer,
        contentId: "qr-code",
      },
      {
        filename: "techshift-entrance-pass-qr.png",
        content: qrBuffer,
      },
    ],
  });

  if (result.error) {
    throw new Error(result.error.message);
  }

  return result;
};
