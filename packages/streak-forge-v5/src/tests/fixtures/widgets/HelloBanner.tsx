export const HelloBanner = widget({
  handler: "HelloBannerHandler",
  dynamicClasses: [
    ["bg-red-500", "bg-blue-500", "bg-green-500"],
    ["text-sm", "text-lg"],
  ],
})((props: { data?: { color?: string; heading?: string } }) => {
  const color = props?.data?.color ?? "red";
  const heading = props?.data?.heading ?? "Hello";
  return `<div class="bg-${color}-500 text-lg">${heading}</div>`;
});
