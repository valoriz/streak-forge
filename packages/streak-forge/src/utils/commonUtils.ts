export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms} ms`;
  }

  const seconds = Math.floor(ms / 1000);
  const milliseconds = ms % 1000;

  if (seconds < 60) {
    const secStr = milliseconds > 0 ? `${seconds}.${Math.floor(milliseconds / 100)} sec` : `${seconds} sec`;
    return secStr;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  let result = `${minutes} min`;
  if (remainingSeconds > 0) {
    result += ` ${remainingSeconds} sec`;
  }
  if (milliseconds > 0) {
    result += ` ${milliseconds} ms`;
  }

  return result;
}
