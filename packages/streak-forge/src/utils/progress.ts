class Progress {
  private metadata: Record<string, any>;
  private startTime: number;
  private currentTime: number;
  private onProgress?: Function;

  /**
   * Initializes the Progress class with an optional metadata object.
   * @param metadata - Optional metadata to initialize the progress tracking.
   */
  constructor(metadata: Record<string, any> = {}, options?: { onProgress?: Function }) {
    this.metadata = metadata;
    this.startTime = Date.now();
    this.currentTime = this.startTime;
    this.metadata.startTime = this.startTime;
    this.metadata.totalTime = 0;
    this.onProgress = options?.onProgress;
  }
  /**
   * Updates the progress for a given UUID with the current time and additional metadata.
   * @param uuid - The unique identifier for the progress update.
   * @param metadata - Additional metadata to include in the progress update.
   */
  public updateProgress(uuid: string, ...metadata: unknown[]): void {
    const currentTime = Date.now();
    const options = metadata.slice(-1)[0] as Record<string, any>;
    this.metadata[uuid] = {
      currentTime,
      elapsedTime: currentTime - this.startTime,
      timeTook: currentTime - this.currentTime,
      metadata,
    };
    this.currentTime = currentTime;
    console.info(`\x1b[32m[i]\x1b[0m Progress Update: ${uuid}\x1b[0m process took ${this.metadata[uuid].timeTook}ms`);
    this.metadata.totalTime += this.metadata[uuid].timeTook;
    if (this.onProgress) {
      this.onProgress(this.metadata[uuid], { uuid, stage: options.stage, currentTime });
    }
  }

  /**
   * Retrieves the current progress metadata.
   * @returns The current progress metadata.
   */
  public getProgress(): Record<string, any> {
    return this.metadata;
  }
}

export default Progress;
