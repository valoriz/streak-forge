export interface ProgressMetaInfo {
  uuid: string;
  stage?: string;
  currentTime: number;
}

export interface ProgressOptions {
  onProgress?: (metadata: Record<string, any>, metaInfo: ProgressMetaInfo) => void;
}

// Accumulates per-stage timing (uuid -> {currentTime, elapsedTime, timeTook}) and
// fires onProgress after each stage, matching the external streak-forge-build
// consumer's expected callback/summary shape.
export class Progress {
  private metadata: Record<string, any>;
  private startTime: number;
  private currentTime: number;
  private onProgress?: ProgressOptions["onProgress"];

  constructor(metadata: Record<string, any> = {}, options?: ProgressOptions) {
    this.metadata = metadata;
    this.startTime = Date.now();
    this.currentTime = this.startTime;
    this.metadata.startTime = this.startTime;
    this.metadata.totalTime = 0;
    this.onProgress = options?.onProgress;
  }

  public updateProgress(uuid: string, options?: { stage?: string; [key: string]: unknown }): void {
    const currentTime = Date.now();
    const entry = {
      currentTime,
      elapsedTime: currentTime - this.startTime,
      timeTook: currentTime - this.currentTime,
    };
    this.metadata[uuid] = entry;
    this.currentTime = currentTime;
    this.metadata.totalTime += entry.timeTook;
    this.onProgress?.(entry, { uuid, stage: options?.stage, currentTime });
  }

  public getProgress(): Record<string, any> {
    return this.metadata;
  }
}
