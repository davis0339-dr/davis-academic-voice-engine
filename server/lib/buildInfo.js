// Verifiable build identity, so the running app can prove which code it
// is actually executing instead of asking the user to trust a chat
// transcript. Render auto-populates RENDER_GIT_COMMIT with the exact
// deployed commit SHA; this falls back to reading git directly for local
// dev, and to "unknown" only if neither is available.
import { execSync } from "node:child_process";

let cachedCommit = null;

function resolveCommit() {
  if (cachedCommit) return cachedCommit;
  if (process.env.RENDER_GIT_COMMIT) {
    cachedCommit = process.env.RENDER_GIT_COMMIT;
    return cachedCommit;
  }
  try {
    cachedCommit = execSync("git rev-parse HEAD", { cwd: new URL("../..", import.meta.url).pathname })
      .toString()
      .trim();
  } catch {
    cachedCommit = "unknown";
  }
  return cachedCommit;
}

export function getBuildInfo() {
  const commit = resolveCommit();
  return {
    commit,
    commitShort: commit === "unknown" ? "unknown" : commit.slice(0, 7),
    githubUrl: commit === "unknown" ? null : `https://github.com/davis0339-dr/davis-academic-voice-engine/commit/${commit}`,
  };
}
