# TechShift 2026: Event Management System

This is a high-performance, isolated micro-service built to handle the high-traffic entry and assessment phase of the TechShift 2026 Scholarship Event.

## 🚀 Tech Stack

- **Framework:** Next.js 16 (App Router)
- **Database:** Neon PostgreSQL (Serverless)
- **ORM:** Sequelize
- **Security:** JWT + Device Fingerprinting + API Key Handshake
- **Email:** Resend API
- **AI:** OpenAI GPT-4o (Theory Audit)

## 📁 Key File Structure

- `app/api/register`: Handshake endpoint for WordPress. Triggers Ticket Email.
- `app/api/check-in`: Dual-mode (Camera/Hardware) scanner endpoint. Enforces 3,500 cap.
- `app/api/assessment/login`: Validates attendance and locks Ticket to a specific device.
- `app/api/assessment/submit`: Real-time "Fastest Finger" ranking logic for Top 910.
- `app/api/admin/winners-export`: Secure sync endpoint for Entity B (OneAcademy LMS).

## 🔐 Environment Variables (.env.local)

| Variable              | Description                            |
| :-------------------- | :------------------------------------- |
| `DATABASE_URL`        | Neon PostgreSQL Connection String      |
| `WP_TO_APP_SECRET`    | Shared secret with WordPress Developer |
| `INTERNAL_SYNC_TOKEN` | Shared secret with OneAcademy LMS      |
| `RESEND_API_KEY`      | Resend.com API Key                     |
| `OPENAI_API_KEY`      | OpenAI API Key for Theory Grading      |
| `STAFF_PIN`           | 6-digit PIN for Staff Dashboard Access |

## 🛡️ Business Rules & Security

1. **Physical Gate:** Only users marked as `checked_in` can access the Assessment.
2. **Venue Cap:** The Check-in API automatically disables after 3,500 successful scans.
3. **910 Wall:** Only the top 910 scorers in the Objective section (Ranked by Score + Finish Time) can proceed to the Theory section.
4. **Anti-Cheat:**
   - **Device Lock:** Tickets are locked to the first device used.
   - **Paste Detection:** Clipboard events are blocked in the Theory section.
   - **AI Detection:** OpenAI scans responses for "high-probability AI" patterns.
5. **Course Caps:** Students select their course during Theory. Slots are capped at 42 per course (Dynamic calculation).

## 📡 Integration (WordPress)

WordPress sends a `POST` to `/api/register` with `x-api-key` header.
