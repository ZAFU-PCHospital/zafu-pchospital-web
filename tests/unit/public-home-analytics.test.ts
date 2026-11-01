import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { HomePublicAnalytics } from "../../src/components/home/HomePublicAnalytics";
import {
  publicHomeService,
  publicRankingName,
} from "../../src/features/analytics/public-home-service";
import { shanghaiAcademicYearRange } from "../../src/lib/academic-term";
import type { PrismaClient } from "../../src/generated/prisma/client";
import type { PublicHomeAnalytics } from "../../src/types/contracts";

(globalThis as unknown as { React: typeof React }).React = React;

/** 固定时钟：学年 / DATE 边界与「服务端算出的学年」用同一个 now。 */
const CONTROLLED_NOW = new Date("2020-10-15T12:00:00.000Z");

/** 只替换数据库边界；测试执行真正的策略、聚合查询构造与公开 DTO 投影，不连接任何库。 */
function fixture(t: TestContext) {
  const globals = globalThis as typeof globalThis & { __pcHospitalDb?: PrismaClient };
  const previousDb = globals.__pcHospitalDb;
  const policy = {
    publicRepairStatsEnabled: true,
    publicRepairStatsDetailEnabled: true,
    publicRankingsEnabled: true,
    rankingDisplayName: "NICKNAME",
  };
  const counts: unknown[] = [];
  let aggregates = 0;
  let rankingQueries = 0;
  let memberQueries = 0;
  const db = {
    publicContentSetting: { findUnique: async () => policy as typeof policy | null },
    repairRecord: {
      count: async (input: { where: { repairDate?: unknown } }) => {
        counts.push(input);
        return input.where.repairDate ? 2 : 7;
      },
      aggregate: async () => {
        aggregates += 1;
        return { _sum: { durationMinutes: 90 } };
      },
    },
    $queryRaw: async () => {
      rankingQueries += 1;
      return [{ memberProfileId: "private-member-id", rankingPosition: 1n, approvedCount: 2n }];
    },
    memberProfile: {
      findMany: async () => {
        memberQueries += 1;
        return [
          {
            id: "private-member-id",
            nickname: null,
            realName: "私人实名",
            user: { displayName: "登录账号" },
          },
        ];
      },
    },
  };
  globals.__pcHospitalDb = db as unknown as PrismaClient;
  t.after(() => {
    globals.__pcHospitalDb = previousDb;
  });
  return {
    policy,
    db,
    counts,
    queries: () => ({ aggregates, rankingQueries, memberQueries }),
  };
}

/** 服务端在**同一次**统计里下发的学年 DTO；用同一段区间对账，避免各算各的。 */
function yearDto(): PublicHomeAnalytics["academicYear"] {
  const year = shanghaiAcademicYearRange(CONTROLLED_NOW);
  return {
    label: year.label,
    startInclusive: year.startInclusive.toISOString(),
    endExclusive: year.endExclusive.toISOString(),
  };
}

/** 学年区间的 DATE 边界（`repair_date` 是 DATE 列，见 toDateOnlyBounds）。 */
function yearDateBounds(): { gte: Date; lt: Date } {
  const year = shanghaiAcademicYearRange(CONTROLLED_NOW);
  const start = new Date(year.startInclusive.getTime() + 8 * 60 * 60 * 1000);
  const end = new Date(year.endExclusive.getTime() + 8 * 60 * 60 * 1000);
  return {
    gte: new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())),
    lt: new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate())),
  };
}

test("公开策略缺行、读取失败或全关：没有任何数据查询或公开输出", async (t) => {
  const f = fixture(t);
  f.policy.publicRepairStatsEnabled = false;
  f.policy.publicRankingsEnabled = false;
  const hidden = { academicYear: yearDto(), repairStats: null, rankings: null };
  assert.deepEqual(await publicHomeService.get(CONTROLLED_NOW), hidden);
  f.db.publicContentSetting.findUnique = async () => null;
  assert.deepEqual(await publicHomeService.get(CONTROLLED_NOW), hidden);
  f.db.publicContentSetting.findUnique = async () => {
    throw new Error("database unavailable");
  };
  assert.deepEqual(await publicHomeService.get(CONTROLLED_NOW), hidden);
  assert.equal(f.counts.length, 0);
  assert.deepEqual(f.queries(), { aggregates: 0, rankingQueries: 0, memberQueries: 0 });
});

test("辅助开关关闭：只查询并输出总量；后续请求重新读取开关", async (t) => {
  const f = fixture(t);
  f.policy.publicRepairStatsDetailEnabled = false;
  f.policy.publicRankingsEnabled = false;
  assert.deepEqual(await publicHomeService.get(CONTROLLED_NOW), {
    academicYear: yearDto(),
    repairStats: { totalApprovedCount: 7 },
    rankings: null,
  });
  assert.deepEqual(f.counts, [{ where: { status: "APPROVED", deletedAt: null } }]);
  assert.equal(f.queries().aggregates, 0);
  f.policy.publicRepairStatsEnabled = false;
  assert.deepEqual(await publicHomeService.get(CONTROLLED_NOW), {
    academicYear: yearDto(),
    repairStats: null,
    rankings: null,
  });
  assert.equal(f.counts.length, 1);
});

test("学年固定可算：总量 / 学年数 / 时长都有效，排行按学年查询（不再有「待配置」）", async (t) => {
  const f = fixture(t);
  const result = await publicHomeService.get(CONTROLLED_NOW);
  assert.deepEqual(result, {
    academicYear: yearDto(),
    repairStats: {
      totalApprovedCount: 7,
      details: { yearApprovedCount: 2, totalApprovedDurationMinutes: 90 },
    },
    rankings: { items: [{ rank: 1, displayName: "成员", approvedCount: 2 }] },
  });
  assert.equal(f.queries().rankingQueries, 1);
  assert.equal(JSON.stringify(result).includes("UNCONFIGURED"), false);
});

test("学年首末边界走 DATE 口径；昵称缺失不公开实名、账号或后台 ID", async (t) => {
  const f = fixture(t);
  const result = await publicHomeService.get(CONTROLLED_NOW);
  assert.deepEqual(f.counts[1], {
    where: { status: "APPROVED", deletedAt: null, repairDate: yearDateBounds() },
  });
  assert.deepEqual(result.rankings, {
    items: [{ rank: 1, displayName: "成员", approvedCount: 2 }],
  });
  const json = JSON.stringify(result);
  for (const secret of [
    "private-member-id",
    "私人实名",
    "登录账号",
    "memberProfileId",
    "avatarUrl",
    "userId",
  ]) {
    assert.equal(json.includes(secret), false, secret);
  }
});

test("隐藏姓名时不读取成员资料；实名与昵称模式各自独立", async (t) => {
  const f = fixture(t);
  f.policy.rankingDisplayName = "HIDDEN";
  assert.equal(
    (await publicHomeService.get(CONTROLLED_NOW)).rankings?.items[0].displayName,
    "成员",
  );
  assert.equal(f.queries().memberQueries, 0);
  f.policy.rankingDisplayName = "REAL_NAME";
  assert.equal(
    (await publicHomeService.get(CONTROLLED_NOW)).rankings?.items[0].displayName,
    "私人实名",
  );
  const member = { nickname: " 昵称 ", realName: " 实名 " };
  assert.equal(publicRankingName("NICKNAME", member), "昵称");
  assert.equal(publicRankingName("REAL_NAME", member), "实名");
  assert.equal(publicRankingName("HIDDEN", member), "成员");
});

test("统计失败不隐藏正常排行，排行失败不隐藏正常统计", async (t) => {
  const f = fixture(t);
  const count = f.db.repairRecord.count;
  f.db.repairRecord.count = async () => {
    throw new Error("stats unavailable");
  };
  const rankingsOnly = await publicHomeService.get(CONTROLLED_NOW);
  assert.equal(rankingsOnly.repairStats, null);
  assert.equal(rankingsOnly.rankings?.items.length, 1);
  f.db.repairRecord.count = count;
  f.db.$queryRaw = async () => {
    throw new Error("ranking unavailable");
  };
  const statsOnly = await publicHomeService.get(CONTROLLED_NOW);
  assert.equal(statsOnly.repairStats?.totalApprovedCount, 7);
  assert.equal(statsOnly.rankings, null);
});

test("首页 DOM：全关隐藏；学年标识、零值、空榜和启用内容分别展示", () => {
  const year = { label: "2026–2027 学年", startInclusive: "", endExclusive: "" };
  const render = (data: PublicHomeAnalytics) =>
    renderToStaticMarkup(React.createElement(HomePublicAnalytics, { data }));
  assert.equal(render({ academicYear: year, repairStats: null, rankings: null }), "");
  const stats = {
    totalApprovedCount: 0,
    details: { yearApprovedCount: 0, totalApprovedDurationMinutes: 90 },
  };
  const pending = render({ academicYear: year, repairStats: stats, rankings: { items: [] } });
  const text = pending.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  assert.match(text, /0 台/);
  assert.match(text, /1.5 小时/);
  // 学年标识来自服务端下发的同一段区间，不是前端自己拼的「本学年」
  assert.match(text, /2026–2027 学年维修/);
  assert.match(text, /2026–2027 学年维修排行/);
  assert.doesNotMatch(text, /待配置/);
  assert.equal((pending.match(/<dt>/g) ?? []).length, 3);
  assert.equal((pending.match(/<caption>/g) ?? []).length, 1);
  assert.match(pending, /<th scope="col">排名<\/th>/);
  assert.match(pending, /<th scope="col">成员<\/th>/);
  assert.match(pending, /<th scope="col">维修次数<\/th>/);
  assert.match(pending, /暂无上榜记录/);
  const enabled = render({
    academicYear: year,
    repairStats: null,
    rankings: {
      items: [{ rank: 1, displayName: "公开昵称", approvedCount: 2 }],
    },
  });
  assert.match(enabled, /公开昵称/);
  assert.match(enabled, /第 1 名/);
  assert.match(enabled, /2 次/);
  assert.doesNotMatch(enabled, /累计服务设备/);
});

test("首页首屏：Hero 维修读数 + 跑马灯贴底；第二屏收进 home-content", async (t) => {
  const f = fixture(t);
  // Icon 的图形在模块加载时创建，须在测试的 React 全局初始化之后加载 Hero。
  const { Hero } = await import("../../src/components/home/Hero");
  const { DocsSection } = await import("../../src/components/home/DocsSection");
  const { default: HomePage } = await import("../../src/app/page");
  const loadOpening = async () => {
    const page = await HomePage();
    const children = React.Children.toArray(page.props.children);
    const firstScreen = renderToStaticMarkup(
      React.createElement(React.Fragment, null, children[0]),
    );
    return { firstScreen, second: children[1] as React.ReactElement<{ id?: string }> };
  };
  const { firstScreen: opening, second } = await loadOpening();
  assert.match(opening, /class="home-first-screen"/);
  assert.match(opening, /href="#public-statistics"/);
  assert.match(opening, /class="ticker"/);
  assert.doesNotMatch(opening, /id="home-content"/, "首屏容器里不能再放第二屏锚点");
  assert.equal(second.props.id, "home-content");
  assert.match(opening, /维修服务记录/);
  assert.doesNotMatch(opening, /内置文档仓库/);

  const data: PublicHomeAnalytics = {
    academicYear: yearDto(),
    repairStats: {
      totalApprovedCount: 7,
      details: { yearApprovedCount: 2, totalApprovedDurationMinutes: 90 },
    },
    rankings: null,
  };
  const hero = renderToStaticMarkup(React.createElement(Hero, { analytics: data }));
  const heroText = hero.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  assert.match(heroText, /维修服务记录/);
  assert.match(heroText, /7 台/);
  assert.match(heroText, /2 台/);
  assert.match(heroText, /1.5 小时/);
  assert.doesNotMatch(heroText, /内置文档仓库/);
  const statsOnly = renderToStaticMarkup(
    React.createElement(Hero, {
      analytics: {
        ...data,
        repairStats: { totalApprovedCount: 7 },
      },
    }),
  );
  assert.match(statsOnly.replace(/<[^>]*>/g, " ").replace(/\s+/g, " "), /7 台/);
  assert.doesNotMatch(statsOnly, /累计维修时长/);

  const hiddenHero = renderToStaticMarkup(
    React.createElement(Hero, {
      analytics: { ...data, repairStats: null, rankings: null },
    }),
  );
  assert.match(hiddenHero, /hero__body--single/);
  assert.doesNotMatch(hiddenHero, /维修服务记录/);

  const docs = renderToStaticMarkup(React.createElement(DocsSection));
  assert.match(docs, /全套维修与排障文档/);
  assert.doesNotMatch(docs, /仓库状态|目录条目|class="readout"|docpreview|src\/ ·/);

  f.policy.publicRepairStatsEnabled = false;
  f.policy.publicRankingsEnabled = false;
  const hidden = await loadOpening();
  assert.doesNotMatch(hidden.firstScreen, /id="public-statistics"/);
  assert.match(hidden.firstScreen, /href="#home-content"/);
  assert.match(hidden.firstScreen, /class="home-first-screen"/);
  assert.match(hidden.firstScreen, /class="ticker"/);
  assert.equal(hidden.second.props.id, "home-content");
});

test("第二屏独立开关：详细统计关闭不泄露辅助指标，并列与同名成员不丢行", () => {
  const year = { label: "2026–2027 学年", startInclusive: "", endExclusive: "" };
  const visible: PublicHomeAnalytics = {
    academicYear: year,
    repairStats: { totalApprovedCount: 7 },
    rankings: {
      items: [
        { rank: 1, displayName: "成员", approvedCount: 2 },
        { rank: 1, displayName: "成员", approvedCount: 2 },
      ],
    },
  };
  const render = (data: PublicHomeAnalytics) =>
    renderToStaticMarkup(React.createElement(HomePublicAnalytics, { data }));
  const html = render(visible);
  assert.equal((html.match(/aria-label="第 1 名"/g) ?? []).length, 2);
  assert.equal((html.match(/<th scope="row">成员<\/th>/g) ?? []).length, 2);
  assert.equal((html.match(/<dt>/g) ?? []).length, 1);
  assert.doesNotMatch(html, /累计维修时长|<dt>2026–2027 学年维修<\/dt>/);
  const statsOnly = render({ ...visible, rankings: null });
  assert.match(statsOnly, /累计服务设备/);
  assert.doesNotMatch(statsOnly, /<table|2026–2027 学年维修排行/);
  const rankingOnly = render({ ...visible, repairStats: null });
  assert.match(rankingOnly, /2026–2027 学年维修排行/);
  assert.match(rankingOnly, /按2026–2027 学年审核通过的维修次数排序/);
  assert.doesNotMatch(rankingOnly, /<dl|累计服务设备/);
  assert.match(
    render({
      academicYear: year,
      repairStats: null,
      rankings: {
        items: [{ rank: 1, displayName: '<script>alert("x")</script>', approvedCount: 0 }],
      },
    }),
    /&lt;script&gt;/,
  );
});
