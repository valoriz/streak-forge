export const StaticBadge = widget({})((props: { data?: { label?: string } }) => {
  const label = props?.data?.label ?? "New";
  return `<span class="badge">${label}</span>`;
});
