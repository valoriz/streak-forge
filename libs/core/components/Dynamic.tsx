import { customTags } from "@core/libs/constants";
import { createElement } from "react";

export interface DynamicProps {
  children?: React.ReactNode;
  id: string;
}

const Dynamic = (props: DynamicProps) => {
  const { children, ...rest } = props;
  return createElement(customTags.DYNAMIC, { ...rest }, children);
};

export default Dynamic;
