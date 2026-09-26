const axios = require("axios");
const fs = require("fs");
const csv = require("csv-parser"); // npm install csv-parser

const WP_API_KEY = process.env.WP_API_KEY;
const EVENT_PORTAL_URL =
  process.env.EVENT_PORTAL_URL ||
  "https://event-portal.example.com/api/register";

async function processBackfill() {
  const results: any[] = [];

  // 1. Read your WP Export CSV
  fs.createReadStream("registrants.csv")
    .pipe(csv())
    .on("data", (data: any) => results.push(data))
    .on("end", async () => {
      console.log(`🚀 Starting Backfill for ${results.length} people...`);

      for (const person of results) {
        try {
          // 2. Hit the Event Portal Registration API
          // This will save them to Neon and automatically trigger the Resend Ticket
          const res = await axios.post(
            EVENT_PORTAL_URL,
            {
              name: person.full_name,
              email: person.user_email,
              phone: person.user_phone,
              courseInterest: person.selected_course,
            },
            {
              headers: { "x-api-key": WP_API_KEY },
            },
          );

          console.log(
            `Ticket Sent: ${person.user_email} | ID: ${res.data.ticketId}`,
          );
        } catch (error) {
          const err = error as any;
          console.error(
            `Failed: ${person.user_email} | Reason: ${err.response?.data?.message || err.message}`,
          );
        }
      }
      console.log("Backfill Process Complete.");
    });
}

processBackfill();
