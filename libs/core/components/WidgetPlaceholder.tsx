import { customTags } from "@core/libs/constants";
import { createElement } from "react";

interface WidgetPlaceholderSuperProps {
  children?: React.ReactNode;
}

export interface StaticWidgetPlaceholderProps extends WidgetPlaceholderSuperProps {
  id: string;
  type: string;
}
export interface DynamicWidgetPlaceholderProps extends WidgetPlaceholderSuperProps {
  type: typeof customTags.DYNAMIC;
}

const WidgetPlaceholder = (props: StaticWidgetPlaceholderProps | DynamicWidgetPlaceholderProps) => {
  const { children, id, type, ...rest } = props as StaticWidgetPlaceholderProps;
  if (type && type !== customTags.DYNAMIC && !id) {
    throw new Error(`WidgetPlaceholder requires an 'id' prop when 'type' is specified. Received type: ${type}`);
  }
  return createElement(customTags.WIDGET, { type, id, ...rest }, children);
};

export default WidgetPlaceholder;
