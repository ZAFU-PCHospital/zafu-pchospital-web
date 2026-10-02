import assert from "node:assert/strict";
import test from "node:test";
import { loginDestination } from "../../src/lib/auth/login-destination";

test("登录和已有会话入口使用相同的角色落点，首次改密优先", () => {
  assert.equal(loginDestination({ roles: ["MEMBER"], mustChangePassword: false }), "/member");
  assert.equal(loginDestination({ roles: ["ADMIN"], mustChangePassword: false }), "/admin");
  assert.equal(
    loginDestination({ roles: ["ADMIN", "MEMBER"], mustChangePassword: false }),
    "/admin",
  );
  assert.equal(
    loginDestination({ roles: ["ADMIN"], mustChangePassword: true }),
    "/account/change-password",
  );
  assert.equal(
    loginDestination({ roles: ["MEMBER"], mustChangePassword: true }),
    "/account/change-password",
  );
});
