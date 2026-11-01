import { execSync } from "node:child_process";

import type { NextConfig } from "next";

/**
 * 构建期版本（issue #189）：部署脚本在目标 commit 的独立 worktree 里构建，
 * 因此这里的 HEAD 就是产物对应的提交；CI 与本地开发同样有 `.git`。
 * 允许用 `BUILD_COMMIT_SHA` 覆盖（无 `.git` 的打包构建）；都取不到时留空，
 * 部署脚本 `tools/deploy/deploy-prod.sh` 的 P3 段记录了显式指定方式。
 * 后台显示「未知」而不是一个猜的版本。
 */
function readBuildCommit(): string {
  const fromEnv = process.env.BUILD_COMMIT_SHA?.trim();
  if (fromEnv) return fromEnv;
  try {
    return execSync("git rev-parse HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3_000,
    }).trim();
  } catch {
    return "";
  }
}

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_BUILD_COMMIT: readBuildCommit() },
  reactStrictMode: true,
  /** sharp 是原生模块，只在 Node 运行时加载，不参与打包。 */
  serverExternalPackages: ["sharp"],
  /* 默认会发 `X-Powered-By: Next.js`，等于对外报技术栈（安全审计 F6）。
     nginx 侧也可以用 `proxy_hide_header` 抹掉，这里从源头关掉更省事。 */
  poweredByHeader: false,
  async redirects() {
    return [
      {
        source: "/handbook",
        destination: "/handbook/index.html",
        permanent: false,
      },
    ];
  },
  async headers() {
    return [
      {
        /* 字体是 `public/` 下的静态文件，Next 对 `public/**` 一律发
           `Cache-Control: public, max-age=0` —— 也就是**每次访问都要回源校验**。
           实测：首页正文要等这个 87 KB 的 Archivo 到位（慢网络下 1.2s），
           而它每次都多一次 304 往返（Slow 4G 是 150ms 起），等于白等。
           `/_next/static/**` 早就是 immutable 了，字体没理由例外。
           注意：**换字体文件时要换文件名**（不带内容哈希，immutable 之后改内容
           浏览器不会再来取）。 */
        source: "/fonts/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
