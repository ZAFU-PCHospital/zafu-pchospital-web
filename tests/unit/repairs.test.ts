import assert from "node:assert/strict";
import test from "node:test";
import { AppError, ApiErrorCode } from "../../src/lib/api/errors";
import { apiFailure } from "../../src/lib/api/response";
import {
  createRepairPhotoService,
  detectImageType,
} from "../../src/features/repairs/repair-photo-service";
import {
  repairDetailInclude,
  repairListInclude,
  repairRepository,
} from "../../src/features/repairs/repair-repository";
import { uploadLimits } from "../../src/features/repairs/repair-photo-storage";
import { isRepairTransitionAllowed } from "../../src/features/repairs/repair-state";
import {
  isBlankDraftFields,
  normalizeDraftFields,
  validateDraftFields,
  validateSubmission,
} from "../../src/features/repairs/repair-validation";
import { repairFieldLimits, formatRepairParticipants } from "../../src/config/repairs";
import { composeParticipantIds } from "../../src/features/repairs/repair-service";
import {
  RepairResult,
  RepairStatus,
  RepairTimelineEventType,
  type RepairDraftFields,
} from "../../src/types/contracts";
import {
  draftInput,
  parseRepairListStatus,
  repairListInput,
} from "../../src/features/repairs/repair-http";
import { listWhere } from "../../src/features/repairs/repair-query-service";
import { toRepairView } from "../../src/features/repairs/repair-view";
import { normalizePhotoViewOrder } from "../../src/components/repairs/photo-order";

/** 管理端维修列表的筛选：日期走 DATE 列边界，结束日必须含全天（与  同源）。 */
test("维修列表日期筛选：DATE 列边界 + 结束日含全天", () => {
  const actor = { userId: "u1", permissions: ["repair:review"] as const };
  const where = listWhere(
    { page: 1, pageSize: 20, repairDateFrom: "2026-09-30", repairDateTo: "2026-09-30" },
    actor,
  );
  const range = where.repairDate as { gte?: Date; lt?: Date; lte?: Date };
  assert.equal(range.gte?.toISOString(), "2026-09-30T00:00:00.000Z");
  assert.equal(
    range.lt?.toISOString(),
    "2026-10-01T00:00:00.000Z",
    "结束日含全天 → 次日零点为排他上界",
  );
  assert.equal(range.lte, undefined, "不得再用 lte：它只在 Prisma 按 UTC 截断时才碰巧正确");

  // 日历上不存在的日期必须被拒，而不是生成 Invalid Date 交给数据库
  assert.throws(
    () => listWhere({ page: 1, pageSize: 20, repairDateTo: "2026-02-30" }, actor),
    (e) => e instanceof AppError && e.code === "VALIDATION_FAILED",
  );
});

test("列表搜索词覆盖机主姓名（电话不参与搜索）", () => {
  const actor = { userId: "u1", permissions: ["repair:read"] as const };
  const where = listWhere({ page: 1, pageSize: 20, query: "张三" }, actor);
  const clauses = where.OR as Array<Record<string, unknown>>;
  assert.ok(
    clauses.some((clause) => "ownerName" in clause),
    "搜索词应包含 ownerName 条件",
  );
  assert.ok(
    clauses.every((clause) => !("ownerPhone" in clause)),
    "机主电话不得参与搜索",
  );
});

test("管理端列表中「全部」默认排除草稿，显式草稿与成员视角不受影响（issue #220）", () => {
  const reviewer = { userId: "a1", permissions: ["repair:review"] as const };
  const member = { userId: "m1", permissions: ["repair:read"] as const };
  assert.deepEqual(
    listWhere({ page: 1, pageSize: 20 }, reviewer).status,
    { not: "DRAFT" },
    "管理员未选状态时默认排除草稿",
  );
  assert.equal(
    listWhere({ page: 1, pageSize: 20, status: "DRAFT" }, reviewer).status,
    "DRAFT",
    "显式选择草稿仍可查看",
  );
  assert.equal(
    listWhere({ page: 1, pageSize: 20, status: "PENDING" }, reviewer).status,
    "PENDING",
    "其它显式状态不加排除条件",
  );
  assert.equal(
    listWhere({ page: 1, pageSize: 20 }, member).status,
    undefined,
    "成员视角不变：仍能读取自己的草稿",
  );
});

test("案例库准入（issue #134）：flagged=any 解析为 ANY，缺省不过滤，非法值 400", () => {
  assert.equal(repairListInput(new URLSearchParams("flagged=any"), 1, 20).flagged, "ANY");
  assert.equal(
    repairListInput(new URLSearchParams(""), 1, 20).flagged,
    undefined,
    "缺省 = 不过滤，保持既有调用方兼容",
  );
  assert.throws(
    () => repairListInput(new URLSearchParams("flagged=typical"), 1, 20),
    (e) => e instanceof AppError && e.code === "VALIDATION_FAILED",
    "白名单外取值必须 400，不能静默忽略",
  );
});

test("案例库准入（issue #134）：flagged=ANY 注入「典型 ∪ 疑难」并集，且不顶掉关键词搜索", () => {
  const actor = { userId: "u1", permissions: ["repair:read"] as const };
  const where = listWhere({ page: 1, pageSize: 20, flagged: "ANY", query: "张三" }, actor);
  // 并集条件必须走 AND 数组注入。注意 visibility 的 OR 也在 AND 里，要按标记键认准。
  const and = where.AND as Array<Record<string, unknown>>;
  const flagClause = and.find((clause) => {
    const or = clause.OR as Array<Record<string, unknown>> | undefined;
    return Array.isArray(or) && or.some((c) => "isTypical" in c || "isDifficult" in c);
  });
  assert.ok(flagClause, "flagged=ANY 必须在 AND 数组里注入并集条件");
  assert.deepEqual(flagClause?.OR, [{ isTypical: true }, { isDifficult: true }]);
  // 红线：顶层 OR（关键词搜索）不得被并集条件顶掉 —— Prisma 同一对象同名键后者覆盖前者
  const search = where.OR as Array<Record<string, unknown>>;
  assert.ok(
    search.some((clause) => "ownerName" in clause),
    "关键词搜索必须与 flagged 并存",
  );
  // 缺省 flagged 时 AND 里不得出现任何标记过滤（管理端 / 成员记录列表行为零变化）
  const plain = listWhere({ page: 1, pageSize: 20 }, actor);
  const plainAnd = plain.AND as Array<Record<string, unknown>>;
  const plainHasFlag = plainAnd.some((clause) => {
    const or = clause.OR as Array<Record<string, unknown>> | undefined;
    return (
      "isTypical" in clause ||
      "isDifficult" in clause ||
      (Array.isArray(or) && or.some((c) => "isTypical" in c || "isDifficult" in c))
    );
  });
  assert.equal(plainHasFlag, false, "不传 flagged 不得注入标记过滤");
});

test("M2 公共枚举与错误码已冻结", () => {
  assert.deepEqual(RepairStatus, ["DRAFT", "PENDING", "APPROVED", "REJECTED"]);
  assert.deepEqual(RepairResult, ["COMPLETED", "NOT_COMPLETED"]);
  assert.equal(RepairTimelineEventType.includes("FLAG_CHANGED"), true);
  for (const code of [
    "MEMBER_REQUIRED",
    "REPAIR_NOT_FOUND",
    "REPAIR_VERSION_CONFLICT",
    "REPAIR_PHOTO_STORAGE_FAILED",
  ])
    assert.equal(ApiErrorCode.includes(code as never), true);
});
test("维修状态机只接受任务书规定流转", () => {
  assert.equal(isRepairTransitionAllowed("DRAFT", "PENDING"), true);
  assert.equal(isRepairTransitionAllowed("REJECTED", "PENDING"), true);
  assert.equal(isRepairTransitionAllowed("PENDING", "APPROVED"), true);
  assert.equal(isRepairTransitionAllowed("PENDING", "REJECTED"), true);
  // 撤回审核已下线：待审核不能回到草稿。
  assert.equal(isRepairTransitionAllowed("PENDING", "DRAFT"), false);
  assert.equal(isRepairTransitionAllowed("APPROVED", "DRAFT"), false);
  assert.equal(isRepairTransitionAllowed("DRAFT", "APPROVED"), false);
  assert.equal(isRepairTransitionAllowed("REJECTED", "DRAFT"), false);
});
test("提交完整性：日期、时长、分类、机主姓名与电话必填；正文与照片不再是门槛", () => {
  const complete = {
    repairDate: new Date("2026-09-15T00:00:00.000Z"),
    durationMinutes: 45,
    categoryId: "category",
    ownerName: "张三",
    ownerPhone: "13800138000",
    deviceModel: "联想小新 Air 14",
    content: null,
    result: "COMPLETED",
  };
  // 无正文、无照片即可通过（正文与照片退出提交门槛）。
  validateSubmission(complete);

  assert.throws(
    () =>
      validateSubmission({
        repairDate: null,
        durationMinutes: null,
        categoryId: null,
        ownerName: null,
        ownerPhone: null,
        deviceModel: null,
        content: null,
        result: null,
      }),
    (e) => e instanceof AppError && e.code === "REPAIR_SUBMISSION_INCOMPLETE",
  );
  // 机主姓名 / 电话必填：缺哪项报哪项的 fieldErrors。
  for (const [field, patch] of [
    ["ownerName", { ownerName: null }],
    ["ownerPhone", { ownerPhone: null }],
    // 机型提交必填：历史记录不回填，只在提交这一刻要求。
    ["deviceModel", { deviceModel: null }],
  ] as const) {
    assert.throws(
      () => validateSubmission({ ...complete, ...patch }),
      (e) =>
        e instanceof AppError &&
        e.code === "REPAIR_SUBMISSION_INCOMPLETE" &&
        e.fieldErrors?.[field] !== undefined,
      `缺 ${field} 应报 REPAIR_SUBMISSION_INCOMPLETE 并定位到 ${field}`,
    );
  }
  // 电话必须是 11 位大陆手机号。
  assert.throws(
    () => validateSubmission({ ...complete, ownerPhone: "12345678901" }),
    (e) =>
      e instanceof AppError &&
      e.code === "REPAIR_SUBMISSION_INCOMPLETE" &&
      e.fieldErrors?.ownerPhone !== undefined,
  );
  // 维修时长提交必填：其余项齐了但缺时长要拦下。
  assert.throws(
    () => validateSubmission({ ...complete, durationMinutes: null }),
    (e) =>
      e instanceof AppError &&
      e.code === "REPAIR_SUBMISSION_INCOMPLETE" &&
      e.fieldErrors?.durationMinutes !== undefined,
  );
  // 时长越界与小数同样拒绝：草稿阶段的上下限在提交口径里继续生效。
  for (const durationMinutes of [0, 10081, 45.5]) {
    assert.throws(
      () => validateSubmission({ ...complete, durationMinutes }),
      (e) => e instanceof AppError && e.code === "REPAIR_SUBMISSION_INCOMPLETE",
      `${durationMinutes} 分钟应当被拒绝`,
    );
  }
  // `content` 不再是提交必填，但带了超长正文仍要拦（管理员历史数据修正路径）。
  assert.throws(
    () => validateSubmission({ ...complete, content: "字".repeat(10001) }),
    (e) => e instanceof AppError && e.code === "REPAIR_SUBMISSION_INCOMPLETE",
  );
  // 机型上限 60（与 `device_model VARCHAR(60)` 对齐）：提交口径同样拦超长值。
  assert.throws(
    () => validateSubmission({ ...complete, deviceModel: "机".repeat(61) }),
    (e) =>
      e instanceof AppError &&
      e.code === "REPAIR_SUBMISSION_INCOMPLETE" &&
      e.fieldErrors?.deviceModel !== undefined,
  );
  assert.throws(() => validateDraftFields({ durationMinutes: 10081 }), AppError);
});

test("草稿校验：机主字段可空，填了则受上限与格式约束；电话按存储口径归一", () => {
  // 草稿允许机主姓名 / 电话为空（与日期 / 时长同思路）。
  validateDraftFields({});
  validateDraftFields({ ownerName: null, ownerPhone: null });
  // 姓名超长与非法电话在保存草稿阶段就要拦下。
  assert.throws(
    () => validateDraftFields({ ownerName: "名".repeat(41) }),
    (e) =>
      e instanceof AppError &&
      e.code === "VALIDATION_FAILED" &&
      e.fieldErrors?.ownerName !== undefined,
  );
  assert.throws(
    () => validateDraftFields({ ownerPhone: "1380013800" }),
    (e) =>
      e instanceof AppError &&
      e.code === "VALIDATION_FAILED" &&
      e.fieldErrors?.ownerPhone !== undefined,
  );
  // 归一：姓名 trim、电话剔除非数字、空串落 null。
  assert.equal(normalizeDraftFields({ ownerName: " 张三 " }).ownerName, "张三");
  assert.equal(normalizeDraftFields({ ownerName: "   " }).ownerName, null);
  assert.equal(normalizeDraftFields({ ownerPhone: "138-0013-8000" }).ownerPhone, "13800138000");
  assert.equal(normalizeDraftFields({ ownerPhone: "" }).ownerPhone, null);
  assert.equal(normalizeDraftFields({}).ownerName, undefined, "未提交的字段保持 undefined（不动）");
  // 机型：草稿可空、填了 trim、超长在草稿阶段就拦。
  assert.equal(normalizeDraftFields({ deviceModel: " 联想 小新 " }).deviceModel, "联想 小新");
  assert.equal(normalizeDraftFields({ deviceModel: "   " }).deviceModel, null);
  assert.equal(normalizeDraftFields({}).deviceModel, undefined, "未提交的机型保持不动");
  assert.throws(
    () => validateDraftFields({ deviceModel: "机".repeat(61) }),
    (e) =>
      e instanceof AppError &&
      e.code === "VALIDATION_FAILED" &&
      e.fieldErrors?.deviceModel !== undefined,
  );
  validateDraftFields({ deviceModel: "机".repeat(60) });
  // 只填机型也不属于「空白建档」：不能拿它复用一条空草稿。
  assert.equal(isBlankDraftFields({ deviceModel: "联想小新" }), false);
  assert.equal(isBlankDraftFields({}), true);
});

test("维修日期上下限在保存草稿时就生效，而不是等到提交", () => {
  const future = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString().slice(0, 10);
  for (const repairDate of ["2019-12-31", future]) {
    assert.throws(
      () => validateDraftFields({ repairDate }),
      (e) => e instanceof AppError && e.code === "VALIDATION_FAILED",
      `${repairDate} 应当被拒绝`,
    );
  }
  // 边界：下限当天与今天都合法。
  validateDraftFields({ repairDate: repairFieldLimits.repairDateMin });
  validateDraftFields({ repairDate: new Date().toISOString().slice(0, 10) });
});

test("草稿字段错误直接说明字段与原因，仅读取 message 的表单也能定位", () => {
  const cases: Array<[RepairDraftFields, keyof RepairDraftFields, string]> = [
    [{ repairDate: "无效日期" }, "repairDate", "维修日期格式无效"],
    [{ repairDate: "2019-12-31" }, "repairDate", "维修日期不得早于 2020-01-01"],
    [{ repairDate: "9999-12-31" }, "repairDate", "维修日期不能晚于今天"],
    ...[0, 10081, 45.5].map(
      (durationMinutes): [RepairDraftFields, keyof RepairDraftFields, string] => [
        { durationMinutes },
        "durationMinutes",
        "维修时长须为 1–10080 分钟的整数",
      ],
    ),
    [{ ownerName: "名".repeat(41) }, "ownerName", "机主姓名不能超过 40 字"],
    [{ ownerPhone: "1380013800" }, "ownerPhone", "机主电话须为 11 位中国大陆手机号"],
    [{ content: "字".repeat(10001) }, "content", "维修内容不能超过 10000 字"],
    [{ remark: "字".repeat(2001) }, "remark", "备注不能超过 2000 字"],
    [{ result: "INVALID" as RepairResult }, "result", "维修结果无效"],
  ];
  for (const [input, field, message] of cases) {
    assert.throws(
      () => validateDraftFields(input),
      (error) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.code, "VALIDATION_FAILED");
        assert.equal(error.message, message);
        assert.deepEqual(error.fieldErrors, { [field]: [message] });
        return true;
      },
      field,
    );
  }
});

test("多项草稿错误在 API message 中一起返回，并保留字段映射", async () => {
  let error: unknown;
  try {
    validateDraftFields({ durationMinutes: 0, ownerPhone: "123", remark: "字".repeat(2001) });
  } catch (caught) {
    error = caught;
  }
  assert.ok(error instanceof AppError);
  const response = apiFailure(error, "req_repair_validation");
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.success, false);
  assert.equal(body.error.code, "VALIDATION_FAILED");
  assert.equal(
    body.error.message,
    "维修时长须为 1–10080 分钟的整数；机主电话须为 11 位中国大陆手机号；备注不能超过 2000 字",
  );
  assert.deepEqual(body.error.fieldErrors, {
    durationMinutes: ["维修时长须为 1–10080 分钟的整数"],
    ownerPhone: ["机主电话须为 11 位中国大陆手机号"],
    remark: ["备注不能超过 2000 字"],
  });
});

test("提交缺项与非法电话的 message 同样说明具体字段", () => {
  const complete = {
    repairDate: new Date("2026-09-15T00:00:00.000Z"),
    durationMinutes: 45,
    categoryId: "category",
    ownerName: "张三",
    ownerPhone: "13800138000",
    deviceModel: "联想小新 Air 14",
    content: null,
    result: "COMPLETED",
  };
  const cases = [
    [{ repairDate: null }, "请填写维修日期"],
    [{ durationMinutes: null }, "请填写维修时长"],
    [{ categoryId: null }, "请选择故障分类"],
    [{ ownerName: null }, "请填写机主姓名"],
    [{ ownerPhone: null }, "请填写机主电话"],
    [{ ownerPhone: "12345678901" }, "机主电话须为 11 位中国大陆手机号"],
    [{ deviceModel: null }, "请填写机型"],
    [{ result: null }, "维修结果缺失"],
    [{ ownerName: null, ownerPhone: null }, "请填写机主姓名；请填写机主电话"],
  ] as const;
  for (const [patch, message] of cases) {
    assert.throws(
      () => validateSubmission({ ...complete, ...patch }),
      (error) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.code, "REPAIR_SUBMISSION_INCOMPLETE");
        assert.equal(error.message, message);
        assert.equal(
          Object.values(error.fieldErrors ?? {})
            .flat()
            .join("；"),
          message,
        );
        return true;
      },
    );
  }
});
test("图片魔数拒绝伪造 MIME 并识别 JPEG PNG WebP", () => {
  assert.equal(detectImageType(Uint8Array.from([0xff, 0xd8, 0xff, 0x00])), "image/jpeg");
  assert.equal(
    detectImageType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    "image/png",
  );
  assert.equal(
    detectImageType(Uint8Array.from([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBP")])),
    "image/webp",
  );
  assert.equal(detectImageType(Uint8Array.from(Buffer.from("not-an-image"))), null);
});

test("照片本地顺序：写操作后按展示顺序收敛为 0..n-1（issue #235）", () => {
  const photo = (id: string, sortOrder: number) => ({
    id,
    contentUrl: `/api/v1/repair-photos/${id}/content`,
    thumbnailUrl: `/api/v1/repair-photos/${id}/content?variant=thumb`,
    originalName: null,
    mimeType: "image/png",
    sizeBytes: 1,
    width: null,
    height: null,
    sortOrder,
    createdAt: "2026-10-01T00:00:00.000Z",
  });
  const input = [photo("a", 0), photo("b", 2), photo("c", 2)];
  const output = normalizePhotoViewOrder(input);
  assert.deepEqual(
    output.map((item) => item.sortOrder),
    [0, 1, 2],
  );
  assert.equal(output[0], input[0], "序号已正确的项保持原对象");
  assert.notEqual(output[1], input[1], "序号需要修正的项返回新对象");
});

test("已有照片加本次上传超限时，在读取文件和调用存储前拒绝", async (t) => {
  const { maxFiles } = uploadLimits();
  t.mock.method(repairRepository, "getById", async () =>
    recordRow({ status: "PENDING", photos: Array.from({ length: maxFiles }, () => ({})) }),
  );
  const file = new File([Uint8Array.from([0xff, 0xd8, 0xff])], "extra.jpg", {
    type: "image/jpeg",
  });
  const read = t.mock.method(file, "arrayBuffer");
  const storage = {
    put: t.mock.fn(async () => ({ storageKey: "unused.jpg" })),
    open: t.mock.fn(async () => new Uint8Array()),
    delete: t.mock.fn(async () => {}),
  };
  await assert.rejects(
    () =>
      createRepairPhotoService(storage).upload("r1", [file], {
        actorType: "USER",
        userId: "u1",
        userStatus: "ACTIVE",
        permissions: ["repair:update"],
        requestId: "req_photo_limit",
      }),
    (error) => error instanceof AppError && error.code === "REPAIR_PHOTO_LIMIT_EXCEEDED",
  );
  assert.equal(read.mock.callCount(), 0);
  assert.equal(storage.put.mock.callCount(), 0);
  assert.equal(storage.delete.mock.callCount(), 0);
});

test("维修列表查询只读取列表 DTO 需要的关联（issue #235）", () => {
  assert.equal("reviews" in repairListInclude, false, "列表不返回审核记录，不应读取");
  assert.equal("timeline" in repairListInclude, false, "列表不返回时间线，不应读取");
  for (const key of ["memberProfile", "category", "photos", "participants"]) {
    assert.ok(key in repairListInclude, `列表 DTO 需要的 ${key} 必须保留`);
    assert.ok(key in repairDetailInclude, `详情应包含列表关联 ${key}`);
  }
  assert.ok("reviews" in repairDetailInclude);
  assert.ok("timeline" in repairDetailInclude);
});

test("维修列表 status 查询白名单：合法预选，非法忽略", () => {
  assert.equal(parseRepairListStatus("REJECTED"), "REJECTED");
  assert.equal(parseRepairListStatus("DRAFT"), "DRAFT");
  assert.equal(parseRepairListStatus("PENDING"), "PENDING");
  assert.equal(parseRepairListStatus("APPROVED"), "APPROVED");
  assert.equal(parseRepairListStatus(""), "");
  assert.equal(parseRepairListStatus(null), "");
  assert.equal(parseRepairListStatus(undefined), "");
  assert.equal(parseRepairListStatus("DONE"), "");
  assert.equal(parseRepairListStatus("rejected"), "");
});

/** `toRepairView` 只消费记录行的一部分字段；夹具用最小形状 + 断言里的 cast。 */
function recordRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "r1",
    memberProfile: {
      id: "m1",
      nickname: null,
      realName: "张三",
      userId: "u1",
      user: { displayName: null },
    },
    // 参与者：默认只有创建人本人（迁移回填后的常态形状）。
    participants: [
      {
        memberProfileId: "m1",
        memberProfile: {
          id: "m1",
          nickname: null,
          realName: "张三",
          user: { displayName: null },
        },
      },
    ],
    repairDate: new Date("2026-09-15T00:00:00.000Z"),
    durationMinutes: 45,
    category: null,
    deviceModel: null,
    ownerName: "李雷",
    ownerPhone: "13800138000",
    content: null,
    result: "COMPLETED",
    remark: null,
    status: "APPROVED",
    isDifficult: false,
    isTypical: false,
    version: 1,
    submittedAt: null,
    reviewedAt: null,
    createdAt: new Date("2026-09-15T01:00:00.000Z"),
    updatedAt: new Date("2026-09-15T01:00:00.000Z"),
    photos: [],
    ...overrides,
  } as unknown as Parameters<typeof toRepairView>[0];
}

test("机主电话可见性 fail-closed：默认不下发，显式放行才给完整号", () => {
  const row = recordRow();
  assert.equal(toRepairView(row).ownerPhone, null, "调用方忘了传权限时不得暴露");
  assert.equal(toRepairView(row, {}).ownerPhone, null);
  assert.equal(toRepairView(row, { canViewOwnerPhone: false }).ownerPhone, null);
  assert.equal(toRepairView(row, { canViewOwnerPhone: true }).ownerPhone, "13800138000");
  // 机主姓名不参与收口：任何调用方都拿得到。
  assert.equal(toRepairView(row).ownerName, "李雷");
  assert.equal(toRepairView(row).ownerPhone === "13800138000", false, "不得下发掩码或完整号");
});

test("参与人员（issue #114）：归一去空白去重保序，超限报错而不截断", () => {
  // 归一：去空白、去重、保持提交顺序；不做静默截断（超限交给校验明确报错）。
  assert.deepEqual(
    normalizeDraftFields({ participantIds: [" m2 ", "m3", "m2", "  "] }).participantIds,
    ["m2", "m3"],
  );
  assert.deepEqual(normalizeDraftFields({ participantIds: [] }).participantIds, []);
  assert.equal(
    normalizeDraftFields({}).participantIds,
    undefined,
    "未提交的字段保持 undefined（不动）",
  );
  // 「只带了空数组」不算有内容：空建档请求仍可复用旧的空白草稿。
  assert.equal(isBlankDraftFields({ participantIds: [] }), true);
  assert.equal(isBlankDraftFields({ participantIds: ["m2"] }), false);
  // 上限含创建人本人：额外成员数组最多 participantMaxCount - 1 个。
  const max = repairFieldLimits.participantMaxCount;
  assert.equal(max, 9, "创建人加 8 名协作者，总人数上限固定为 9 人");
  const extras = (count: number) => Array.from({ length: count }, (_, index) => `m${index + 2}`);
  validateDraftFields({ participantIds: extras(8) });
  assert.throws(
    () => validateDraftFields({ participantIds: extras(9) }),
    (error) =>
      error instanceof AppError &&
      error.code === "VALIDATION_FAILED" &&
      error.fieldErrors?.participantIds?.[0] === `参与维修人员最多 ${max} 人（含创建人本人）`,
  );
});

test("composeParticipantIds：创建人恒在首位，重复 id 只保留一次", () => {
  assert.deepEqual(composeParticipantIds("m1", ["m2", "m3"]), ["m1", "m2", "m3"]);
  // 额外成员里混入创建人本人或重复：去重后仍只有一条，且创建人在首位。
  assert.deepEqual(composeParticipantIds("m1", ["m2", "m1", "m2"]), ["m1", "m2"]);
  assert.deepEqual(composeParticipantIds("m1", []), ["m1"]);
});

test("参与者 HTTP 入参拒绝非字符串元素，不能把非法名单变成清空操作", () => {
  for (const participantIds of [[123], ["m2", null], [true], [{}], null, "m2"]) {
    assert.throws(
      () => draftInput({ participantIds }),
      (error) => error instanceof AppError && error.code === "VALIDATION_FAILED",
    );
  }
  assert.equal(draftInput({}).participantIds, undefined);
  assert.deepEqual(draftInput({ participantIds: [] }).participantIds, []);
  assert.deepEqual(draftInput({ participantIds: ["m2"] }).participantIds, ["m2"]);
  assert.throws(
    () => normalizeDraftFields({ participantIds: [123] as unknown as string[] }),
    (error) => error instanceof AppError && error.code === "VALIDATION_FAILED",
  );
});

test("参与者 UUID 大小写在归一与创建人去重时统一", () => {
  const creator = "aabbccdd-0000-4000-8000-000000000001";
  const extra = "aabbccdd-0000-4000-8000-000000000002";
  const fields = normalizeDraftFields({
    participantIds: [extra.toUpperCase(), ` ${extra} `, creator.toUpperCase()],
  });
  assert.deepEqual(fields.participantIds, [extra, creator]);
  assert.deepEqual(composeParticipantIds(creator, fields.participantIds!), [creator, extra]);
  assert.deepEqual(composeParticipantIds(creator.toUpperCase(), [creator, extra.toUpperCase()]), [
    creator,
    extra,
  ]);
});

test("参与者展示（issue #114）：toRepairView 按参与行映射姓名并把创建人排到首位", () => {
  const row = recordRow({
    participants: [
      {
        memberProfileId: "m2",
        memberProfile: {
          id: "m2",
          nickname: "阿伟",
          realName: "王五",
          user: { displayName: null },
        },
      },
      {
        memberProfileId: "m1",
        memberProfile: { id: "m1", nickname: null, realName: "张三", user: { displayName: null } },
      },
    ],
  });
  assert.deepEqual(toRepairView(row).participants, [
    { id: "m1", name: "张三" },
    { id: "m2", name: "阿伟" },
  ]);
});

test("formatRepairParticipants：全部参与者顿号连接；空数组回退创建人", () => {
  const view = toRepairView(recordRow());
  assert.equal(formatRepairParticipants(view), "张三");
  assert.equal(
    formatRepairParticipants({
      ...view,
      participants: [
        { id: "m1", name: "张三" },
        { id: "m2", name: "阿伟" },
      ],
    }),
    "张三、阿伟",
  );
});
