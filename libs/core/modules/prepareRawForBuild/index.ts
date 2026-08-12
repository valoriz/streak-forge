import type { HandlerOptions } from "@core/types";
import type { UserStreakConfigOut } from "./types";
import path from "path";

const validationConfiguration = {};

const getContentPath = (base: string, directoryNames: string[]) => {
  return path.join(base, ...directoryNames);
};

const getCurrentDateTime = () => Date.now().toString();

const handler = (options: HandlerOptions) => async (previousConfig: UserStreakConfigOut) => {
  const renderId = previousConfig.renderId || "default";
  const version = previousConfig.version || getCurrentDateTime();

  const contentToSave: {
    [key: string]: string;
  }[] = [
    {
      type: "text/json",
      v: version,
      id: renderId,
      content: JSON.stringify(previousConfig),
      path: getContentPath(version, ["raw-content.json"]),
    },
  ];

  return contentToSave;
};

export { validationConfiguration as validation, handler };
