import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "../../src/lib/api/errors";
import { permissionsForRoles, requirePermission } from "../../src/lib/auth/permissions";

test("管理员与成员权限边界固定", () => {
  assert.equal(permissionsForRoles(["MEMBER"]).includes("join:read"), false);
  assert.equal(permissionsForRoles(["ADMIN"]).includes("join:review"), true);
});

test("未登录、禁用账号与普通成员均不能读取报名", () => {
  assert.throws(
    () => requirePermission(null, "join:read"),
    (error) => hasCode(error, "UNAUTHENTICATED"),
  );
  assert.throws(
    () =>
      requirePermission(
        {
          actorType: "USER",
          userId: "user",
          userStatus: "DISABLED",
          permissions: ["join:read"],
          requestId: "req",
        },
        "join:read",
      ),
    (error) => hasCode(error, "FORBIDDEN"),
  );
  assert.throws(
    () =>
      requirePermission(
        {
          actorType: "USER",
          userId: "user",
          userStatus: "ACTIVE",
          permissions: permissionsForRoles(["MEMBER"]),
          requestId: "req",
        },
        "join:read",
      ),
    (error) => hasCode(error, "FORBIDDEN"),
  );
});

function hasCode(error: unknown, code: string): boolean {
  return error instanceof AppError && error.code === code;
}
