export const logMetrics = {
  checkin: (barcodeId: string, success: boolean) => {
    console.log(
      JSON.stringify({
        type: "metric",
        name: "checkin_attempt",
        barcodeId: barcodeId.substring(0, 8) + "...", // Partial for privacy
        success,
        timestamp: new Date().toISOString(),
      }),
    );
  },

  capacity: (current: number, limit: number) => {
    console.log(
      JSON.stringify({
        type: "metric",
        name: "capacity",
        current,
        limit,
        percentage: Math.round((current / limit) * 100),
        timestamp: new Date().toISOString(),
      }),
    );
  },

  flag: (barcodeId: string, reason: string) => {
    console.log(
      JSON.stringify({
        type: "security",
        name: "user_flagged",
        barcodeId: barcodeId.substring(0, 8) + "...",
        reason,
        timestamp: new Date().toISOString(),
      }),
    );
  },
};
