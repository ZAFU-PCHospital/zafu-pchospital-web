import assert from "node:assert/strict";
import test from "node:test";

import robots from "../../src/app/robots";
import sitemap from "../../src/app/sitemap";
import { siteConfig } from "../../src/config/site";
import { docPageUrl, docTree, flattenDocTree, type DocListItem } from "../../src/lib/docs";

/**
 * 公开站的抓取入口（robots.txt / sitemap.xml）
 *
 * 这里守的是两类真实事故：
 * 1. `siteConfig.url` 曾经是占位值 `https://github.com/ZAFU-PCHospital`，
 *    而它是 metadataBase、robots 与 sitemap 三处绝对地址的唯一来源 ——
 *    站点上线后爬虫与社交卡片拿到的全是仓库地址。
 * 2. 后台与成员区一旦被收录，索引里就多出一堆「跳登录页」的无效地址。
 */

/** 不该出现在 sitemap、必须出现在 robots 屏蔽名单里的前缀 */
const PRIVATE_PREFIXES = ["/api", "/admin", "/account", "/member", "/login", "/register"];

test("siteConfig.url 是正式域名，不是仓库地址、也不带尾部斜杠", () => {
  assert.ok(siteConfig.url.startsWith("https://"), `应为 https 地址：${siteConfig.url}`);
  assert.equal(siteConfig.url, siteConfig.url.trim());
  assert.ok(!siteConfig.url.endsWith("/"), "末尾带斜杠会让拼出的地址出现双斜杠");
  assert.ok(
    !siteConfig.url.includes("github.com"),
    "它是 metadataBase / robots / sitemap 的绝对地址基准，填仓库地址会让爬虫拿到错域名",
  );
});

test("robots.txt 屏蔽后台、成员区与接口，并指向本站 sitemap", () => {
  const robotsConfig = robots();
  const rules = Array.isArray(robotsConfig.rules) ? robotsConfig.rules : [robotsConfig.rules];
  const disallow = rules.flatMap((rule) => rule.disallow ?? []);

  for (const prefix of PRIVATE_PREFIXES) {
    assert.ok(
      disallow.includes(prefix) || disallow.includes(`${prefix}/`),
      `robots 未屏蔽 ${prefix}（当前：${disallow.join(" ")}）`,
    );
  }
  assert.equal(robotsConfig.sitemap, `${siteConfig.url}/sitemap.xml`);
});

test("sitemap 只收录公开页面，且地址全部基于 siteConfig.url", () => {
  const entries = sitemap();
  assert.ok(entries.length > 0, "sitemap 不应为空");

  const paths = entries.map((entry) => {
    assert.ok(entry.url.startsWith(siteConfig.url), `条目未基于 siteConfig.url：${entry.url}`);
    return entry.url.slice(siteConfig.url.length);
  });

  for (const path of paths) {
    for (const prefix of PRIVATE_PREFIXES) {
      assert.ok(path !== prefix && !path.startsWith(`${prefix}/`), `sitemap 不应收录 ${prefix}`);
    }
  }

  for (const route of ["/", "/about", "/join", "/tools", "/repair-activities"]) {
    assert.ok(paths.includes(route), `sitemap 缺少公开路由 ${route}`);
  }
});

test("sitemap 里的文档条目与文档清单逐个对齐（占位清单下自然为零）", () => {
  const paths = new Set(sitemap().map((entry) => entry.url.slice(siteConfig.url.length)));
  const ready = flattenDocTree(docTree).filter(
    (item): item is Extract<DocListItem, { type: "item" }> =>
      item.type === "item" && !item.pending && Boolean(item.outputPath),
  );

  for (const item of ready) {
    assert.ok(paths.has(docPageUrl(item.outputPath!)), `sitemap 缺少文档条目 ${item.outputPath}`);
  }
});
