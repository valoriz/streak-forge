import { createElement } from "react";

export interface PreloadProps extends React.HTMLAttributes<HTMLLinkElement> {
  as: string;
  href: string;
}

const Preload = (props: PreloadProps) => {
  const { ...rest } = props;
  return createElement("preload", { ...rest });
};

export default Preload;
