"use client";

import { RepairEditor } from "./RepairEditor";

/**
 * 新建维修记录：点进来就是表单，没有「先建草稿再编辑」的中间步。
 *
 *  起**进页面不建档**：非图片内容暂存在 sessionStorage，提交时才落库，
 * 因此反复进出不会留下一串空草稿；刷新 / 站内跳走可恢复，提交成功后清除暂存。
 *
 * 新建流程为同页两步：填写（含选填照片）→ 核对确认 → 提交即建单，再批量上传照片。
 *
 * 带 `activityId + registrationId` 时是活动接待的「继续填写」，
 * 表单从登记行预填、提交时才创建维修单并关联接待，同样不落草稿。
 */
export function CreateRepairForm({
  serveContext,
  photoLimits,
}: {
  serveContext?: { activityId: string; registrationId: string };
  photoLimits: { maxBytes: number; maxFiles: number };
}) {
  return (
    <RepairEditor
      allowSaveDraft={false}
      serveContext={serveContext}
      returnActivityId={serveContext?.activityId}
      photoLimits={photoLimits}
    />
  );
}
