export const HelloBannerHandler = handler({ scope: "widget" })(async (metadata?: Record<string, unknown>) => {
  return { color: "blue", heading: "Hello from handler" };
});
