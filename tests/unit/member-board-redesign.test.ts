import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { memberRepairActivitiesCopy } from "../../src/config/repair-activities";

/**
 * 工作台改版（后续）的接线契约。
 *
 * runtime 面薄（页面结构与样式重排），真正会悄悄坏掉的是接线：
 * 页头把静态标题换成活动名、栏头计数绑错数组、排队卡三区被打回两列混排。
 */

const boardSource = readFileSync(
  "src/components/repair-activities/MemberRepairActivityBoard.tsx",
  "utf8",
);
const pageSource = readFileSync("src/app/member/repair-activities/[id]/page.tsx", "utf8");
const pageAlertSource = readFileSync("src/components/ui/PageAlert.tsx", "utf8");
const cssSource = readFileSync("src/app/globals.css", "utf8");

test("页头：小标签 + 活动名主标题 + 日期行，三种状态共用同一页头", () => {
  assert.match(boardSource, /<h1 className="sec-title" id="member-activity-board-title">/);
  assert.ok(boardSource.includes("board.activity.title"));
  assert.ok(boardSource.includes("formatShanghaiDateTime(board.activity.activityAt)"));
  // 状态徽章（issue #239）：与列表共用成员端文案，结束时按本地时钟先切到 ENDED。
  assert.ok(boardSource.includes("memberRepairActivityStatusBadgeClass(status)"));
  assert.match(boardSource, /ended \? "ENDED" : board\.activity\.status/);
  // 加载态与错误态用固定标题兜底占位（共 2 处），活动名就绪后替换。
  assert.equal((boardSource.match(/\{renderHead\(copy\.title\)\}/g) ?? []).length, 2);
  // 静态页头已从 page.tsx 移除：避免出现两个 h1 / 双份标题。
  assert.equal(pageSource.includes("member-page-head"), false);
  assert.ok(memberRepairActivitiesCopy.board.label.includes("活动工作台"));
});

test("栏头计数：三个分区都带数量，排队人数单独强调", () => {
  assert.ok((boardSource.match(/activity-board__pane-count/g) ?? []).length >= 3);
  assert.ok(
    boardSource.includes(
      'className="activity-board__pane-count activity-board__pane-count--queue"',
    ),
  );
  assert.ok(boardSource.includes("{board.eligible.length}"));
  assert.ok(boardSource.includes("{board.queue.length}"));
  assert.ok(boardSource.includes("{board.servedCount}"));
});

test("排队卡三区：详情行「标签 + 值」成对，操作区沉底", () => {
  for (const key of ["phone", "issueType", "checkedInAt", "deviceModel"]) {
    assert.ok(
      boardSource.includes(`activity-board__queue-label">{copy.${key}}</`),
      `详情行应带 ${key} 标签`,
    );
  }
  assert.ok((boardSource.match(/activity-board__queue-value/g) ?? []).length >= 4);
  assert.ok(
    boardSource.includes(
      'className="activity-board__row-actions activity-board__row-actions--foot"',
    ),
  );
});

test("样式接线：计数强调、标签定宽、窄屏主按钮加宽、对比度提升", () => {
  assert.match(cssSource, /\.activity-board__pane-count--queue \{[^}]*color: var\(--accent\)/);
  assert.match(cssSource, /\.activity-board__queue-label \{[^}]*min-inline-size: 4\.5em/);
  assert.match(
    cssSource,
    /@media \(max-width: 759px\) \{\s*\.activity-board__row-actions--foot \.activity-board__serve-btn\.btn \{\s*flex: 1;/,
  );
  // 次级文字从 muted(--ink-3) 提到 --ink-2；操作区点线分隔。
  assert.match(cssSource, /\.activity-board__check-meta \{[^}]*color: var\(--ink-2\)/);
  assert.match(cssSource, /\.activity-board__row-actions--foot \{[^}]*border-top: 1px dotted/);
});

test("留空收紧（第二轮反馈·方案 A）：页面级错误改共享浮动提示，卡片与工具行只隔网格间距", () => {
  // 页面级错误不再内联占位：板面里只剩签到弹窗内那一处定高错误行，工具行与卡片之间没有常驻带。
  assert.equal((boardSource.match(/activity-board__feedback/g) ?? []).length, 1);
  // 页面级错误 = 共享 PageAlert（Portal 浮条，role=alert），CSS 固定定位、不参与布局。
  assert.ok(boardSource.includes("<PageAlert message={floatingMessage} />"));
  assert.ok(pageAlertSource.includes('className="card page-alert__body"'));
  assert.ok(pageAlertSource.includes('role="alert"'));
  assert.match(cssSource, /\.page-alert \{[^}]*position: fixed/);
  assert.match(cssSource, /\.activity-board \{[^}]*gap: var\(--s-3\)/);
  // 弹窗内错误行仍是定高预留（错误出现 / 清空不挤动弹窗按钮），图标走语义令牌。
  assert.match(cssSource, /\.activity-board__feedback \{[^}]*block-size: 2lh/);
  assert.match(cssSource, /\.page-alert__body > svg \{[^}]*color: var\(--status-danger\)/);
});
