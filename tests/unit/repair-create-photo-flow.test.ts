import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const editor = readFileSync("src/components/repairs/RepairEditor.tsx", "utf8");
const picker = readFileSync("src/components/repairs/PendingPhotoPicker.tsx", "utf8");
const summary = readFileSync("src/components/repairs/RepairCreateSummary.tsx", "utf8");
const createForm = readFileSync("src/components/repairs/CreateRepairForm.tsx", "utf8");
const newPage = readFileSync("src/app/member/repairs/new/page.tsx", "utf8");

test("新建页把服务端照片上限传给编辑器", () => {
  assert.match(newPage, /uploadLimits\(\)/);
  assert.match(newPage, /photoLimits=\{uploadLimits\(\)\}/);
  assert.match(createForm, /photoLimits: \{ maxBytes: number; maxFiles: number \}/);
  assert.match(createForm, /photoLimits=\{photoLimits\}/);
});

test("新建流程为同页两步：填写（含照片）→ 核对确认", () => {
  assert.match(editor, /type CreateStep = "edit" \| "confirm"/);
  assert.match(editor, /const \[createStep, setCreateStep\] = useState<CreateStep>\("edit"\)/);
  assert.match(editor, /createStep === "confirm"/);
  assert.match(editor, /RepairCreateSummary/);
  assert.match(editor, /repairEditorCopy\.confirmTitle/);
  assert.match(editor, /repairEditorCopy\.nextStep/);
  assert.match(editor, /repairEditorCopy\.confirmSubmit/);
  assert.match(editor, /function goToConfirm\(\)/);
  assert.match(editor, /validateSubmission\(/);
  assert.match(editor, /setCreateStep\("confirm"\)/);
});

test("确认步骤先建单再批量上传照片，照片仍为选填", () => {
  const confirm = editor.slice(editor.indexOf("async function confirmCreate"));
  assert.ok(confirm.includes("createServeRecord()"));
  assert.ok(confirm.includes("createRepairRecord()"));
  assert.ok(confirm.includes("await uploadPendingPhotos(recordId)"));
  assert.ok(
    confirm.includes("if (pendingPhotos.length) await uploadPendingPhotos(recordId);"),
    "没有照片时直接跳过上传",
  );
  assert.ok(confirm.indexOf("createRepairRecord()") < confirm.indexOf("uploadPendingPhotos"));
  assert.match(editor, /files\.forEach|pendingPhotos\.forEach/);
  assert.match(editor, /form\.append\("photos", photo\.file\)/);
  assert.match(picker, /multiple/);
  assert.match(picker, /accept=\{REPAIR_PHOTO_ACCEPT\}/);
});

test("照片选择在确认步骤之前，且确认页展示已选照片", () => {
  assert.match(editor, /<PendingPhotoPicker/);
  assert.match(editor, /onAdd=\{addPendingPhotos\}/);
  assert.match(editor, /onRemove=\{removePendingPhoto\}/);
  assert.ok(
    editor.indexOf("<PendingPhotoPicker") < editor.indexOf("repairEditorCopy.nextStep"),
    "照片选择区排在「下一步」之前",
  );
  assert.match(summary, /<PendingPhotoPicker/);
  assert.match(summary, /photos=\{photos\}/);
  assert.match(summary, /readOnly/);
});

test("上传失败保留重试入口，建单成功后不重复建单", () => {
  assert.match(editor, /recordCreatedUploadFailed/);
  assert.match(editor, /async function retryUpload\(\)/);
  assert.match(editor, /goToRecordDetail/);
  assert.match(editor, /createdRecordId/);
  assert.match(editor, /function completeCreate\(recordId: string\)/);
  assert.match(editor, /clearPendingPhotos\(\)/);
  assert.match(
    editor,
    /onRemovePhoto=\{createdRecordId && !busy \? removePendingPhoto : undefined\}/,
  );
  assert.match(summary, /allowRemove=\{Boolean\(onRemovePhoto\)\}/);
  assert.match(picker, /allowRemove/);
  assert.match(editor, /createSubmittingRef/);
  assert.match(editor, /if \(busy \|\| createSubmittingRef\.current \|\| !record\) return/);
  assert.match(
    editor,
    /if \(busy \|\| createSubmittingRef\.current \|\| !createdRecordId\) return/,
  );
});

test("照片暂存做了类型、大小与数量预检", () => {
  assert.match(
    editor,
    /validatePhotoSelection\(files, pendingPhotos\.length, record\.photoLimits\)/,
  );
  assert.match(editor, /formatPhotoSelectionError/);
  assert.match(editor, /URL\.createObjectURL/);
  assert.match(editor, /URL\.revokeObjectURL/);
  assert.match(editor, /photoPendingNote/);
});

test("第一步校验失败时聚焦并滚动到首个错误字段", () => {
  assert.match(editor, /const CREATE_FIELD_SELECTORS/);
  assert.match(editor, /Object\.keys\(error\.fieldErrors \?\? \{\}\)\[0\]/);
  assert.match(editor, /scrollIntoView\(\{ block: "center" \}\)/);
  assert.match(editor, /focus\(\{ preventScroll: true \}\)/);
});
