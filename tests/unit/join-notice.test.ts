import assert from "node:assert/strict";
import test from "node:test";

import { joinNotice, joinNoticeItems } from "../../src/config/join";

const titles = joinNoticeItems.map((item) => item.title);
const allCopy = [
  ...joinNoticeItems.flatMap((item) => [item.title, item.description]),
  ...joinNotice.paragraphs,
].join("\n");

test("招新须知覆盖六项已确认信息与账号发放说明", () => {
  assert.equal(joinNoticeItems.length, 6);
  for (const title of [
    "招新时间窗口",
    "报名与截止",
    "面试与结果",
    "面试与培训安排",
    "值班时长要求",
    "账号发放与首次登录",
  ]) {
    assert.ok(titles.includes(title), `缺少须知条目：${title}`);
  }
});

test("须知文案包含验收必需的事实", () => {
  for (const fact of [
    "百团大战",
    "加群获取",
    "群公告",
    "当面公布",
    "集体培训",
    "最低值班时长",
    "邮箱发送账号与初始密码",
    "联系管理员",
    "修改密码",
  ]) {
    assert.ok(allCopy.includes(fact), `缺少事实：${fact}`);
  }
});

test("公开页不再出现待确认占位，也不公开初始密码规则", () => {
  for (const placeholder of ["待社团确认", "待补充", "QQ 号后 6 位"]) {
    assert.equal(allCopy.includes(placeholder), false, `仍含占位：${placeholder}`);
  }
});
