"use client";

import { RepairPhotoGallery } from "@/components/repairs/RepairPhotoGallery";
import { Button } from "@/components/ui/Button";
import { adminCopy, adminShared } from "@/config/admin";
import type { RepairPhotoView } from "@/types/contracts";

/**
 * 审核弹窗里的照片区。
 *
 * 照片不在列表载荷里，打开窗口时单独取详情；读取失败（含无权限）必须与
 * 「这条记录没有照片」分开提示，否则审核员会误以为记录没传图。
 */
export function RepairReviewPhotos({
  photos,
  error,
  onRetry,
}: {
  /** `null` = 正在读取。 */
  photos: RepairPhotoView[] | null;
  error: string;
  onRetry: () => void;
}) {
  const copy = adminCopy.repairs.detail;
  return (
    <section className="admin-photos">
      <h4 className="admin-panel__title">{copy.photos}</h4>
      {photos === null ? (
        <p className="admin-note">{adminShared.loading}</p>
      ) : error ? (
        <div className="gap-s-2 grid" role="alert">
          <p className="admin-note">
            {copy.photosLoadFailed}：{error}
          </p>
          <Button onClick={onRetry}>{adminShared.reload}</Button>
        </div>
      ) : photos.length === 0 ? (
        <p className="admin-note">{copy.photosEmpty}</p>
      ) : (
        <RepairPhotoGallery photos={photos} showOriginalName />
      )}
    </section>
  );
}
