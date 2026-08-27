import { renderToString } from "./jsx/renderToString";

export const renderComponent = async (
  component: (props: any) => any,
  props: any,
): Promise<string> => {
  const result = await component(props);
  return renderToString(result);
};
