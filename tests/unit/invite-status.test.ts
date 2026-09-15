import assert from "node:assert/strict";
import test from "node:test";

import { getInviteCodeEffectiveStatus } from "../../src/features/invitations/invite-code-service";

const now = new Date("2026-09-15T08:00:00.000Z");

test("邀请码有效状态由事实派生", () => {
  assert.equal(
    getInviteCodeEffectiveStatus(
      { status: "ACTIVE", activeFrom: null, expiresAt: null, maxUses: 2, usedCount: 1 },
      now,
    ),
    "ACTIVE",
  );
  assert.equal(
    getInviteCodeEffectiveStatus(
      {
        status: "ACTIVE",
        activeFrom: new Date("2026-09-16T00:00:00Z"),
        expiresAt: null,
        maxUses: 2,
        usedCount: 0,
      },
      now,
    ),
    "NOT_STARTED",
  );
  assert.equal(
    getInviteCodeEffectiveStatus(
      {
        status: "ACTIVE",
        activeFrom: null,
        expiresAt: new Date("2026-09-15T07:59:59Z"),
        maxUses: 2,
        usedCount: 0,
      },
      now,
    ),
    "EXPIRED",
  );
  assert.equal(
    getInviteCodeEffectiveStatus(
      { status: "ACTIVE", activeFrom: null, expiresAt: null, maxUses: 1, usedCount: 1 },
      now,
    ),
    "EXHAUSTED",
  );
  assert.equal(
    getInviteCodeEffectiveStatus(
      { status: "REVOKED", activeFrom: null, expiresAt: null, maxUses: 1, usedCount: 0 },
      now,
    ),
    "REVOKED",
  );
});
