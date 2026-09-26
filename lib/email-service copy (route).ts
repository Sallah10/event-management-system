import { Resend } from "resend";
import QRCode from "qrcode";

const resend = new Resend(process.env.RESEND_API_KEY);

export const sendEntranceTicket = async (registrant: any) => {
  // Use your own domain to serve the QR — works on Vercel, no external service
  const qrImageUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/qr/${registrant.barcodeId}`;

  const result = await resend.emails.send({
    from: "TechShift 2026 <techshift@mail.1techacademy.com>",
    to: registrant.email,
    subject: "Hi " + registrant.name.split(" ")[0] + ", You're In! 🎟️",
    html: `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: auto; border: 1px solid #e0e0e0; border-radius: 16px; overflow: hidden; color: #333; line-height: 1.6;">
        
        <div style="background: #0000FF; color: #fff; padding: 40px 20px; text-align: center;">
          <h1 style="margin: 0; font-size: 28px; letter-spacing: -1px;">TechShift 2026</h1>
          <p style="margin-top: 10px; opacity: 0.9; font-weight: bold; text-transform: uppercase; font-size: 12px; letter-spacing: 2px;">Official Entrance Ticket</p>
        </div>

        <div style="padding: 40px;">
          <h2 style="color: #0000FF; margin-top: 0;">Hi ${registrant.name.split(" ")[0]}, You're In!</h2>
          
          <p>Congratulations! Your seat at the <strong>TechShift 2026 Summit</strong> is officially reserved for <strong>April 18th</strong> at the <strong>Sheraton Balmoral, Lagos</strong>.</p>
          <p>By registering, you have taken the first step toward joining the 3,500 attendees of TechShift and also being a part of the <strong>546 scholarships</strong> available.</p>

          <div style="background: #FFFBEB; border: 2px dashed #FFBB00; border-radius: 12px; padding: 30px; text-align: center; margin: 30px 0;">
            <p style="margin-top: 0; font-weight: bold; color: #854D0E;">YOUR UNIQUE ENTRANCE CODE</p>
            
            <img src="${qrImageUrl}" width="200" height="200" style="display: block; margin: 0 auto 15px;" alt="Entrance QR Code" />
            
            <div style="background: #0000FF; color: #fff; display: inline-block; padding: 8px 20px; border-radius: 8px; font-family: monospace; font-size: 20px; font-weight: bold;">
              ${registrant.barcodeId}
            </div>
            <p style="font-size: 12px; color: #666; margin-top: 15px;">Present this QR code for physical check-in at the venue.</p>
            <div style="font-size: 13px; color: #333; font-weight: bold; margin-top: 15px;">This QR code is your digital pass and will be scanned at the entrance.</div>
          </div>

          <h3 style="color: #0000FF;">Prepare for the Scholarship</h3>
          <p>To qualify for the <strong>₦505 Million Scholarship Fund</strong>, you must complete the digital assessment. Use your unique access code above to log in when the portal opens.</p>

          <div style="background: #F8FAFC; border-left: 4px solid #0000FF; padding: 20px; margin: 20px 0;">
            <p style="margin: 0;"><strong>TechShift Event:</strong> April 18th</p>
            <p style="margin: 5px 0 0; font-size: 14px; color: #64748B;">You must be physically present at the Sheraton Balmoral to activate your scholarship eligibility. <strong>No attendance, no scholarship.</strong></p>
          </div>

          <p>The Digital Assessment portal opening will be announced at the event.</p>
          <p>Between now and April 18th, stay tuned to our social media channels and emails. Your future is no longer a dream; it is a scheduled event.</p>
          <p>We will see you at TechShift 2026.</p>

          <div style="text-align: center; margin: 40px 0 20px;">
            <p style="font-weight: bold; color: #0000FF; margin-bottom: 15px;">Follow us on social media for updates:</p>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 0 auto;">
              <tr>
                <td style="padding: 0 12px; text-align: center;">
                  <a href="https://www.instagram.com/1tech_academy/" target="_blank" style="text-decoration: none;">
                    <img src="https://img.icons8.com/color/48/000000/instagram-new.png" alt="Instagram" width="32" height="32" style="display: block; margin: 0 auto;" />
                    <span style="color: #666; font-size: 12px; display: block; margin-top: 4px;">Instagram</span>
                  </a>
                </td>
                <td style="padding: 0 12px; text-align: center;">
                  <a href="https://www.facebook.com/people/1Tech-Academy/61573710158376/" target="_blank" style="text-decoration: none;">
                    <img src="https://img.icons8.com/color/48/000000/facebook-new.png" alt="Facebook" width="32" height="32" style="display: block; margin: 0 auto;" />
                    <span style="color: #666; font-size: 12px; display: block; margin-top: 4px;">Facebook</span>
                  </a>
                </td>
                <td style="padding: 0 12px; text-align: center;">
                  <a href="https://www.linkedin.com/company/1tech-academy/" target="_blank" style="text-decoration: none;">
                    <img src="https://img.icons8.com/color/48/000000/linkedin.png" alt="LinkedIn" width="32" height="32" style="display: block; margin: 0 auto;" />
                    <span style="color: #666; font-size: 12px; display: block; margin-top: 4px;">LinkedIn</span>
                  </a>
                </td>
                <td style="padding: 0 12px; text-align: center;">
                  <a href="https://x.com/1techAcademy" target="_blank" style="text-decoration: none;">
                    <img src="https://img.icons8.com/ios-filled/50/000000/x.png" alt="X (Twitter)" width="32" height="32" style="display: block; margin: 0 auto;" />
                    <span style="color: #666; font-size: 12px; display: block; margin-top: 4px;">X (Twitter)</span>
                  </a>
                </td>
              </tr>
            </table>
          </div>

          <hr style="border: 0; border-top: 1px solid #eee; margin: 30px 0;" />
          <p style="font-size: 14px; color: #999; text-align: center;">
            <strong>The TechShift 2026 Team</strong><br/>
            1Tech Academy | Making Life Possible
          </p>
          <p style="font-size: 12px; color: #ccc; text-align: center; margin-top: 20px;">
            © 2026 1Tech Academy. All rights reserved.
          </p>
        </div>
      </div>
    `,
  });

  if (result.error) {
    throw new Error(result.error.message);
  }

  return result;
};
