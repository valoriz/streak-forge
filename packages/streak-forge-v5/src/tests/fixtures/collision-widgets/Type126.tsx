export const Type126 = widget({})((props: { data?: { label?: string } }) => {
  const label = props?.data?.label ?? "New";
  return `<span class="b">${label}</span>`;
});
