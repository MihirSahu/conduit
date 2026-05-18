import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const requiredBuildArtifacts = [
  "packages/core/dist/index.js",
  "packages/provider-chatgpt/dist/index.js",
  "packages/cli/dist/index.js",
];

const sourceRoots = [
  "packages/core/src",
  "packages/provider-chatgpt/src",
  "packages/cli/src",
];

if (shouldBuild()) {
  const result = spawnSync("bun", ["run", "build"], {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error("Failed to build workspace packages before tests.");
  }
}

function shouldBuild(): boolean {
  if (!requiredBuildArtifacts.every((path) => existsSync(path))) {
    return true;
  }
  const oldestBuildMtime = Math.min(
    ...requiredBuildArtifacts.map((path) => statSync(path).mtimeMs),
  );
  return newestSourceMtime() > oldestBuildMtime;
}

function newestSourceMtime(): number {
  return Math.max(...sourceRoots.flatMap((root) => sourceFileMtimes(root)));
}

function sourceFileMtimes(path: string): number[] {
  const stat = statSync(path);
  if (stat.isFile()) {
    return path.endsWith(".ts") ? [stat.mtimeMs] : [];
  }
  return readdirSync(path).flatMap((entry) =>
    sourceFileMtimes(join(path, entry)),
  );
}
