import { Redis } from "@upstash/redis";

// Create Redis client from environment variables
export const redis = Redis.fromEnv();

// Or create manually:
// export const redis = new Redis({
//   url: process.env.UPSTASH_REDIS_REST_URL!,
//   token: process.env.UPSTASH_REDIS_REST_TOKEN!,
// });

// Helper functions for your specific use cases
export const flagKey = (barcodeId: string) => `flag:${barcodeId}`;
export const checkinKey = (barcodeId: string) => `checkin:${barcodeId}`;
export const capacityKey = () => "event:capacity";
