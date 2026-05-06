import { isAbsolute, relative } from "node:path";

export function isPathInside(parentPath: string, targetPath: string): boolean {
  const rel = relative(parentPath, targetPath);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}
