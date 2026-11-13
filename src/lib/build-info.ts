/**
 * 构建版本信息。
 *
 * `NEXT_PUBLIC_BUILD_COMMIT` 由 `next.config.ts` 在构建期注入：优先取环境变量
 * `BUILD_COMMIT_SHA`，否则在仓库里执行 `git rev-parse HEAD`；两者都拿不到时为空串，
 * 页面显示「未知」，遥测也不伪造版本。
 */
const COMMIT_PATTERN = /^[0-9a-f]{7,40}$/i;

/** 校验并规整构建提交；非法值（空、分支名、过短）一律返回空串。 */
export function parseBuildCommit(raw: string | null | undefined): {
  commit: string;
  short: string;
} {
  const commit = (raw ?? "").trim().toLowerCase();
  if (!COMMIT_PATTERN.test(commit)) return { commit: "", short: "" };
  return { commit, short: commit.slice(0, 7) };
}

export const buildCommitInfo = parseBuildCommit(process.env.NEXT_PUBLIC_BUILD_COMMIT);
