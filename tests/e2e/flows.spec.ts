import { expect, test } from "@playwright/test";

import { loadSeed, login } from "./support";

test("成员报名 → 管理员签到入队 → 成员接待", async ({ browser, baseURL }) => {
  const seed = loadSeed();
  const memberContext = await browser.newContext({ baseURL });
  const adminContext = await browser.newContext({ baseURL });
  try {
    const memberPage = await memberContext.newPage();
    // Playwright 读不到 sendBeacon 的请求体；在页面内记录一份，仍调用原生实现。
    await memberPage.addInitScript(() => {
      const bodies: string[] = [];
      (window as unknown as { __telemetryBodies: string[] }).__telemetryBodies = bodies;
      const original = navigator.sendBeacon.bind(navigator);
      navigator.sendBeacon = (url: string | URL, data?: BodyInit | null) => {
        if (String(url).includes("/api/v1/telemetry") && data instanceof Blob) {
          void data.text().then((text) => bodies.push(text));
        }
        return original(url, data);
      };
    });
    const telemetry: Array<{ status: number }> = [];
    memberPage.on("response", (response) => {
      if (!response.url().includes("/api/v1/telemetry")) return;
      telemetry.push({ status: response.status() });
    });

    await login(memberPage, seed.member.qq, seed.member.password);
    await memberPage.goto(`/repair-activities/${seed.activity.id}`);
    await expect(memberPage.getByRole("heading", { name: seed.activity.title })).toBeVisible();

    await memberPage.locator("#repair-activity-signup-name").fill(seed.customer.name);
    await memberPage.locator("#repair-activity-signup-phone").fill(seed.customer.phone);
    await memberPage.locator('select[name="issueType"]').selectOption("CLEAN_PASTE");
    await memberPage.getByRole("button", { name: "提交报名", exact: true }).click();
    await memberPage.getByRole("button", { name: "我已阅读并同意", exact: true }).click();
    await expect(memberPage.getByText("报名信息已确认，请按时到场", { exact: true })).toBeVisible();

    // 前端遥测必须真的走通浏览器 → 端点：202、无查询串、带 release。
    await expect
      .poll(() => telemetry.some((entry) => entry.status === 202), { timeout: 20_000 })
      .toBe(true);
    await expect
      .poll(
        () =>
          memberPage.evaluate(
            () =>
              (window as unknown as { __telemetryBodies?: string[] }).__telemetryBodies?.length ??
              0,
          ),
        { timeout: 20_000 },
      )
      .toBeGreaterThan(0);
    const bodies = await memberPage.evaluate(
      () => (window as unknown as { __telemetryBodies?: string[] }).__telemetryBodies ?? [],
    );
    const activityPayload = bodies
      .map((body) => JSON.parse(body) as { kind?: string; route?: string; release?: string })
      .find(
        (payload) =>
          payload.kind === "web-vital" && payload.route?.startsWith("/repair-activities"),
      );
    expect(activityPayload).toBeTruthy();
    expect(activityPayload?.route ?? "").not.toContain("?");
    expect(activityPayload?.release ?? "").toMatch(/^[0-9a-f]{7,40}$/i);

    await memberPage.goto(`/member/repair-activities/${seed.activity.id}`);
    await expect(memberPage.locator(".activity-board--ready")).toBeVisible();
    await memberPage.getByRole("button", { name: "参加本场", exact: true }).click();
    await expect(memberPage.getByText("你已出勤", { exact: true })).toBeVisible();

    const adminPage = await adminContext.newPage();
    await login(adminPage, seed.admin.qq, seed.admin.password);
    await adminPage.goto(`/admin/repair-activities/${seed.activity.id}?tab=board`);
    await expect(adminPage.locator(".activity-board--ready")).toBeVisible();
    await adminPage.getByRole("checkbox", { name: new RegExp(seed.customer.name) }).check();
    await adminPage.getByRole("button", { name: "签到入队", exact: true }).click();
    await adminPage.getByRole("button", { name: "确认签到", exact: true }).click();
    await expect(adminPage.getByText("已签到入队", { exact: true })).toBeVisible();

    await memberPage
      .locator(".activity-board__toolbar")
      .getByRole("button", { name: "立即刷新", exact: true })
      .click();
    const queueRow = memberPage.locator(".activity-board__row").filter({
      hasText: seed.customer.name,
    });
    await expect(queueRow).toBeVisible();
    await queueRow.getByRole("button", { name: "接待", exact: true }).click();
    await expect(memberPage.getByText("已接待，请继续填写维修记录", { exact: true })).toBeVisible();
    await expect(memberPage.locator("#activity-board-served-list")).toContainText(
      seed.customer.name,
    );
  } finally {
    await Promise.all([memberContext.close(), adminContext.close()]);
  }
});
