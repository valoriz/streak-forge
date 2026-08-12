import path from "path";
import config from "@config";
import Progress from "@src/utils/progress";
import type { ChainProcessor, HandlerOptions, RenderConfig, RenderOptions, RenderResponse, RenderPage } from "@core/types";
import { HANDLERS_DIR, LAYOUTS_DIR, PUBLIC_DIR, WIDGETS_DIR } from "@core/libs/constants";
import { getTailwindConfig } from "@core/libs/commonUtils";
import { afterBuild, beforeBuild } from "@core/modules/prepareForSiteOnlyOnce";
// Refactored to run in trigger dev
import * as stageOne from "@core/modules/validateStreakConfig";
import * as stageTwo from "@core/modules/pageDataHandler";
import * as stageThree from "@core/modules/renderRootLayout";
import * as stageFour from "@core/modules/renderWidgets";
import * as stageFive from "@core/modules/pageBuildAndOptimize";
import * as stageSixDev from "@core/modules/applyStyleDev";
import * as stageSevenDev from "@core/modules/finalizePageDev";
import * as prepareRawForBuild from "@core/modules/prepareRawForBuild";
import * as prepareStyle from "@core/modules/prepareStyle";

interface ChainProcessorSteps {
  stage: string;
  process: string;
  handler: Function;
  validation: any;
}

const commonHandlerOptions: Record<string, any> = {
  srcDir: {
    root: config.targetSrc,
    handlerDir: path.join(config.targetSrc, HANDLERS_DIR),
    widgetsDir: path.join(config.targetSrc, WIDGETS_DIR),
    layoutsDir: path.join(config.targetSrc, LAYOUTS_DIR),
    publicDir: path.join(config.targetSrc, PUBLIC_DIR),
    preBuildDir: config.preBuildDir || undefined,
  },
  disableCriticalCss: config.disableCriticalCss,
};

const updateTailwindConfigInOptions = async () => {
  commonHandlerOptions.tailwindConfig = await getTailwindConfig(config.targetSrc);
};

/**
 * Main function to handle the chain of processors for rendering configuration.
 * It processes each step in the chain, validating and handling the configuration.
 * @param renderConfig - The initial render configuration to process.
 * @returns A promise that resolves to the final render configuration after processing all steps.
 */
const chainProcessorCommon: ChainProcessorSteps[] = [
  {
    stage: "step1",
    process: "validateStreakConfig",
    handler: stageOne.handler,
    validation: stageOne.validation,
  },
  {
    stage: "step2",
    process: "pageDataHandler",
    handler: stageTwo.handler,
    validation: stageTwo.validation,
  },
  {
    stage: "step3",
    process: "renderRootLayout",
    handler: stageThree.handler,
    validation: stageThree.validation,
  },
  {
    stage: "step4",
    process: "renderWidgets",
    handler: stageFour.handler,
    validation: stageFour.validation,
  },
];

const chainProcessorDev = [
  ...chainProcessorCommon,
  {
    stage: "step5",
    process: "pageBuildAndOptimize",
    handler: stageFive.handler,
    validation: stageFive.validation,
  },
  {
    stage: "step6",
    process: "applyStyleDev",
    handler: stageSixDev.handler,
    validation: stageSixDev.validation,
  },
  {
    stage: "step7",
    process: "finalizePageDev",
    handler: stageSevenDev.handler,
    validation: stageSevenDev.validation,
  },
];
const chainProcessorBuild = [
  ...chainProcessorCommon,
  {
    stage: "step6",
    process: "prepareStyle",
    handler: prepareStyle.handler,
    validation: prepareStyle.validation,
  },
  {
    stage: "step7",
    process: "prepareRawForBuild",
    handler: prepareRawForBuild.handler,
    validation: prepareRawForBuild.validation,
  },
];

const isRenderConfigValid =
  (validate: ChainProcessor["validate"]) =>
  (config: RenderConfig): boolean => {
    return !Object.keys(validate).some((key) => {
      const validationFunction = validate[key as keyof ChainProcessor["validate"]];
      if (typeof validationFunction !== "function") {
        console.error(`Validation function for ${key} is not a function.`);
        return true;
      }
      const isValid = validationFunction(config);

      if (typeof isValid === "string") {
        throw new Error(isValid);
      }
      return isValid !== true;
    });
  };

/** * Handles the next chain processors recursively.
 * It processes the first processor in the chain, validates the configuration,
 * and then recursively processes the remaining processors.
 * @param renderConfig - The current render configuration to process.
 * @param processorStages - The remaining chain processors to handle.
 * @param progress - The progress tracker to update the status of each step.
 * @returns A promise that resolves to the final render configuration after processing all steps.
 */
const handleNextChainProcessors =
  (renderConfig: RenderConfig) =>
  async (processorStages: ChainProcessorSteps[], progress: Progress, handlerOptions?: HandlerOptions, isBuild?: boolean): Promise<unknown> => {
    const [firstProcessor, ...restProcessors] = processorStages;
    if (!firstProcessor) {
      throw new Error("No processors available to handle.");
    }
    const { stage, handler, validation } = firstProcessor;

    console.info("Processing first chain step:", stage);

    const isValid = isRenderConfigValid(validation)(renderConfig);

    progress.updateProgress(`validation_${stage}`, isValid ? "valid" : "invalid", { stage });

    if (!isValid) {
      throw new Error(`Invalid configuration for stage: ${stage}`);
    }

    const finalHandlerOptions = {
      ...commonHandlerOptions,
      ...(handlerOptions || {}),
      srcDir: {
        ...commonHandlerOptions?.srcDir,
        ...(handlerOptions?.srcDir || {}),
      },
    };

    const currentRenderConfig = await handler(finalHandlerOptions)(renderConfig);
    progress.updateProgress(`handler_${stage}`, isValid ? "valid" : "invalid", { stage });

    if (restProcessors.length > 0) {
      // On build flow: if notFound is set, skip intermediate steps and only run the final one
      const nextProcessors = currentRenderConfig.notFound && restProcessors.length > 1 ? restProcessors.slice(-1) : restProcessors;
      return handleNextChainProcessors(currentRenderConfig)(nextProcessors, progress, handlerOptions, isBuild);
    }
    return currentRenderConfig;
  };

const render = async (renderConfig: RenderConfig, options?: RenderOptions): Promise<RenderResponse> => {
  console.info("Streak Render function executed.");
  await updateTailwindConfigInOptions();

  const onProgress = options?.onProgress;
  const isBuild = options?.isBuild ?? true;
  const onInitialData = options?.onInitialData ?? {};
  const handlerOptions = options?.handlerOptions;

  const processor = isBuild ? chainProcessorBuild : chainProcessorDev;

  if (typeof onInitialData === "function") {
    onInitialData({
      processor,
    });
  }
  const progress = new Progress(undefined, { onProgress });
  const finalRenderConfiguration = await handleNextChainProcessors(renderConfig)(processor, progress, handlerOptions, isBuild);

  return {
    progress: progress.getProgress(),
    ...(isBuild ? { renderedPage: finalRenderConfiguration as RenderPage[] } : { content: finalRenderConfiguration as string }),
    renderConfig: renderConfig,
  };
};

const afterRender = async (buildDir: string) => {
  await updateTailwindConfigInOptions();
  await afterBuild(buildDir, commonHandlerOptions as unknown as HandlerOptions);
};

export { beforeBuild as beforeRender, afterRender, render };
export type { RenderConfig, RenderOptions, RenderResponse };
