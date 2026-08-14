import path from "path";

// Bumped per absolute file path when the watcher sees a change, so the next
// import of that specific file bypasses Bun's module cache without needing
// to restart the whole process or wipe every other cached module.
const cacheBust = new Map<string, number>();

export const invalidateModule = (absoluteFilePath: string) => {
  cacheBust.set(absoluteFilePath, Date.now());
};

const resolveInDir = (dir: string, name: string): string => {
  return require.resolve(path.join(dir, name));
};

export const importFromDir = async (
  dir: string,
  name: string,
): Promise<any> => {
  const resolved = resolveInDir(dir, name);
  const bust = cacheBust.get(resolved);
  const specifier = bust ? `${resolved}?v=${bust}` : resolved;
  return import(specifier);
};

export const resolvedPath = (dir: string, name: string): string =>
  path.resolve(resolveInDir(dir, name));
