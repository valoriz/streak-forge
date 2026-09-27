export const Type105 = widget({})((props: { data?: { label?: string } }) => {
  const label = props?.data?.label ?? "New";
  return `<span class="a">${label}</span>`;
});
