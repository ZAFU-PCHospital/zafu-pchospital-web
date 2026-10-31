"use client";

import {
  defaultRepairResult,
  formatRepairParticipants,
  repairEditorCopy,
  repairResultLabels,
} from "@/config/repairs";
import type { RepairDetailView } from "@/types/contracts";

import { PendingPhotoPicker, type PendingPhoto } from "./PendingPhotoPicker";

type Props = {
  record: RepairDetailView;
  photos: PendingPhoto[];
  serveContext?: boolean;
  /** 建单成功但照片上传失败时，允许先移除有问题的照片再重试。 */
  onRemovePhoto?: (id: string) => void;
};

/** 新建维修记录确认步骤：只读核对字段与本地照片，不在这里发请求。 */
export function RepairCreateSummary({ record, photos, serveContext, onRemovePhoto }: Props) {
  return (
    <div className="gap-s-4 grid">
      {serveContext ? <p className="field__hint">{repairEditorCopy.serveSubmitNote}</p> : null}
      <dl className="repair-detail__facts">
        <div>
          <dt className="text-ink-3 text-sm">{repairEditorCopy.repairDateLabel}</dt>
          <dd>{record.repairDate ?? "待补充"}</dd>
        </div>
        <div>
          <dt className="text-ink-3 text-sm">{repairEditorCopy.ownerNameLabel}</dt>
          <dd>{record.ownerName ?? "待补充"}</dd>
        </div>
        <div>
          <dt className="text-ink-3 text-sm">{repairEditorCopy.ownerPhoneLabel}</dt>
          <dd>{record.ownerPhone ?? "待补充"}</dd>
        </div>
        <div>
          <dt className="text-ink-3 text-sm">{repairEditorCopy.categoryLabel}</dt>
          <dd>{record.category?.name ?? "待补充"}</dd>
        </div>
        <div>
          <dt className="text-ink-3 text-sm">{repairEditorCopy.deviceModelLabel}</dt>
          <dd>{record.deviceModel ?? "待补充"}</dd>
        </div>
        <div>
          <dt className="text-ink-3 text-sm">{repairEditorCopy.durationLabel}</dt>
          <dd>{record.durationMinutes === null ? "待补充" : `${record.durationMinutes} 分钟`}</dd>
        </div>
        <div>
          <dt className="text-ink-3 text-sm">{repairEditorCopy.participantsLabel}</dt>
          <dd>{formatRepairParticipants(record)}</dd>
        </div>
        <div>
          <dt className="text-ink-3 text-sm">{repairEditorCopy.resultLabel}</dt>
          <dd>{repairResultLabels[record.result ?? defaultRepairResult] ?? "待补充"}</dd>
        </div>
      </dl>
      <div className="gap-s-2 grid">
        <h3 className="text-ink-3 text-sm">{repairEditorCopy.photosLabel}</h3>
        <PendingPhotoPicker
          photos={photos}
          readOnly
          allowRemove={Boolean(onRemovePhoto)}
          onRemove={onRemovePhoto}
          emptyLabel={repairEditorCopy.noPhotos}
          disabled={!onRemovePhoto}
        />
        <p className="field__hint">{repairEditorCopy.photosSubmitNote}</p>
      </div>
      <div className="gap-s-2 grid">
        <h3 className="text-ink-3 text-sm">{repairEditorCopy.remarkLabel}</h3>
        <p className="text-ink-2 whitespace-pre-wrap">{record.remark || "未填写"}</p>
      </div>
    </div>
  );
}
