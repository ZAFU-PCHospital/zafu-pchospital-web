import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { before } from "node:test";
import type { ReactElement, ReactNode } from "react";

import { repairEditorCopy } from "../../src/config/repairs";
import type { PendingPhoto } from "../../src/components/repairs/PendingPhotoPicker";
import type { RepairDetailView } from "../../src/types/contracts";

const require = createRequire(import.meta.url);
const React = require("react") as typeof import("react");
let RepairCreateSummary: typeof import("../../src/components/repairs/RepairCreateSummary").RepairCreateSummary;
let PendingPhotoPicker: typeof import("../../src/components/repairs/PendingPhotoPicker").PendingPhotoPicker;

before(async () => {
  (globalThis as unknown as { React: typeof React }).React = React;
  ({ RepairCreateSummary } = await import("../../src/components/repairs/RepairCreateSummary"));
  ({ PendingPhotoPicker } = await import("../../src/components/repairs/PendingPhotoPicker"));
});

type Props = { children?: ReactNode };

function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join("");
  if (React.isValidElement<Props>(node)) return text(node.props.children);
  return typeof node === "string" ? node : "";
}

function findElement(
  node: ReactNode,
  predicate: (element: ReactElement<Record<string, unknown>>) => boolean,
): ReactElement<Record<string, unknown>> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, predicate);
      if (found) return found;
    }
  } else if (React.isValidElement<Record<string, unknown>>(node)) {
    if (predicate(node)) return node;
    return findElement(node.props.children as ReactNode, predicate);
  }
}

const record: RepairDetailView = {
  id: "record-demo",
  member: { id: "member-1", name: "演示成员" },
  participants: [
    { id: "member-1", name: "演示成员" },
    { id: "member-2", name: "协作成员" },
  ],
  repairDate: "2026-10-31",
  durationMinutes: 45,
  category: {
    id: "clean",
    code: "clean",
    name: "清灰保养",
    description: null,
    sortOrder: 1,
    isActive: true,
  },
  deviceModel: "联想小新 Pro 14",
  ownerName: "演示客户",
  ownerPhone: "13800000000",
  content: null,
  result: "COMPLETED",
  remark: "已清灰并更换硅脂",
  status: "PENDING",
  isDifficult: false,
  isTypical: false,
  version: 1,
  submittedAt: "2026-10-31T06:00:00.000Z",
  reviewedAt: null,
  createdAt: "2026-10-31T06:00:00.000Z",
  updatedAt: "2026-10-31T06:00:00.000Z",
  photos: [],
  reviews: [],
  timeline: [],
  canEdit: false,
  canAttachPhotos: true,
  canReview: false,
  canFlag: false,
  isFavorited: false,
  photoLimits: { maxBytes: 10 * 1024 * 1024, maxFiles: 9 },
};

const photos: PendingPhoto[] = [
  {
    id: "pending-1",
    file: new File([new Uint8Array(4)], "a.png", { type: "image/png" }),
    previewUrl: "blob:pending-1",
  },
  {
    id: "pending-2",
    file: new File([new Uint8Array(4)], "b.png", { type: "image/png" }),
    previewUrl: "blob:pending-2",
  },
];

test("确认步骤展示全部字段、参与成员、备注与已选照片", () => {
  const tree = RepairCreateSummary({ record, photos });
  const content = text(tree);
  for (const expected of [
    "2026-10-31",
    "演示客户",
    "13800000000",
    "清灰保养",
    "联想小新 Pro 14",
    "45 分钟",
    "演示成员、协作成员",
    "已完成",
    "已清灰并更换硅脂",
    repairEditorCopy.photosSubmitNote,
  ]) {
    assert.ok(content.includes(expected), `确认步骤应展示 ${expected}`);
  }
  assert.equal(
    findElement(tree, (element) => element.props.alt === "待上传照片 1") !== undefined,
    false,
    "摘要只挂载选择器组件，图片在组件内部",
  );
  const picker = findElement(tree, (element) => element.type === PendingPhotoPicker);
  assert.ok(picker);
  assert.deepEqual(picker.props.photos, photos);
  assert.equal(picker.props.readOnly, true);
  const pickerTree = PendingPhotoPicker(picker.props as Parameters<typeof PendingPhotoPicker>[0]);
  assert.equal(
    findElement(pickerTree, (element) => element.props.alt === "待上传照片 1") !== undefined,
    true,
  );
  assert.equal(
    findElement(pickerTree, (element) => element.props.alt === "待上传照片 2") !== undefined,
    true,
  );
});

test("没有选照片时确认步骤提示照片选填", () => {
  const tree = RepairCreateSummary({ record, photos: [] });
  const picker = findElement(tree, (element) => element.type === PendingPhotoPicker);
  assert.ok(picker);
  assert.deepEqual(picker.props.photos, []);
  const pickerTree = PendingPhotoPicker(picker.props as Parameters<typeof PendingPhotoPicker>[0]);
  assert.ok(text(pickerTree).includes(repairEditorCopy.noPhotos));
});

test("上传失败后确认页只允许移除失败项，成功项已落库不能本地删除", () => {
  const removed: string[] = [];
  const mixed: PendingPhoto[] = [
    { ...photos[0]!, status: "success" },
    { ...photos[1]!, status: "error", error: "网络异常，照片未上传，请重试" },
  ];
  const tree = RepairCreateSummary({
    record,
    photos: mixed,
    onRemovePhoto: (id) => removed.push(id),
    onRetryPhoto: () => {},
  });
  const picker = findElement(tree, (element) => element.type === PendingPhotoPicker);
  assert.ok(picker);
  assert.equal(picker.props.readOnly, true);
  assert.equal(picker.props.allowRemove, true);
  assert.equal(picker.props.disabled, false, "允许移除时按钮必须可用");
  const pickerTree = PendingPhotoPicker(picker.props as Parameters<typeof PendingPhotoPicker>[0]);
  assert.equal(
    findElement(pickerTree, (element) => element.props["aria-label"] === "移除待上传照片 1"),
    undefined,
    "成功上传的照片不能显示移除按钮",
  );
  const remove = findElement(
    pickerTree,
    (element) => element.props["aria-label"] === "移除待上传照片 2",
  );
  assert.ok(remove);
  (remove.props.onClick as () => void)();
  assert.deepEqual(removed, ["pending-2"]);
});
