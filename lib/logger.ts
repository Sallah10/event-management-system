export const logSecurityEvent = (event: string, data: any) => {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      event,
      ...data,
    }),
  );
};
