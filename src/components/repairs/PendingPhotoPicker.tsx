"use client";

import Image from "next/image";
import type { DragEvent } from "react";

import { Button } from "@/components/ui/Button";
import { formatBytes, repairEditorCopy } from "@/config/repairs";

import { REPAIR_PHOTO_ACCEPT } from "./photo-selection";
import { describePreparedPhoto } from "./photo-upload";

export type PendingPhotoStatus = "ready" | "preparing" | "uploading" | "success" | "error";

export type PendingPhoto = {
  id: string;
  file: File;
  previewUrl: string;
  /** 逐张上传状态（issue #324）；未进入上传队列的旧场景可不填。 */
  status?: PendingPhotoStatus;
  /** 0–1 的上传进度，仅 uploading 时有意义。 */
  progress?: number;
  error?: string;
  originalSize?: number;
  preparedSize?: number;
  compressed?: boolean;
  /** 服务端幂等键：同一张照片的重试复用，响应丢失也不会落两张。 */
  uploadKey?: string;
};

type Props = {
  photos: PendingPhoto[];
  hint?: string;
  maxFiles?: number;
  disabled?: boolean;
  readOnly?: boolean;
  /** 只读场景仍允许移除（例如建单后照片上传失败，先删掉有问题的照片再重试）。 */
  allowRemove?: boolean;
  /** 只读场景下按项决定能否移除；缺省全部可移除。摘要页只让失败项移除。 */
  canRemovePhoto?: (photo: PendingPhoto) => boolean;
  emptyLabel: string;
  onAdd?: (files: File[]) => void;
  onRemove?: (id: string) => void;
  onRetry?: (id: string) => void;
};

/** 新建维修记录在提交前暂存的本地照片：预览、逐张状态 / 进度、重试与移除。 */
export function PendingPhotoPicker({
  photos,
  hint,
  maxFiles,
  disabled,
  readOnly,
  allowRemove,
  canRemovePhoto,
  emptyLabel,
  onAdd,
  onRemove,
  onRetry,
}: Props) {
  const canRemove = !readOnly || allowRemove === true;

  function acceptFiles(files: File[]) {
    if (disabled || files.length === 0) return;
    onAdd?.(files);
  }

  function setDragging(element: HTMLElement, dragging: boolean) {
    if (dragging) element.dataset.dragging = "true";
    else delete element.dataset.dragging;
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(event.currentTarget, false);
    acceptFiles(Array.from(event.dataTransfer.files));
  }

  return (
    <div className="gap-s-3 grid">
      {readOnly ? null : (
        <div
          className="photo-dropzone"
          onDragOver={(event) => {
            if (disabled) return;
            event.preventDefault();
            setDragging(event.currentTarget, true);
          }}
          onDragLeave={(event) => setDragging(event.currentTarget, false)}
          onDrop={onDrop}
        >
          <label className="field">
            <span className="field__label">{repairEditorCopy.photoSelectLabel}</span>
            <input
              className="field__input"
              type="file"
              accept={REPAIR_PHOTO_ACCEPT}
              multiple
              disabled={disabled}
              onChange={(event) => {
                // 先拷成数组再清空 input：Blink 的 FileList 是活视图，
                // 清空 value 会把它一起清空；拷成数组后「同一张再选一次」也能触发 change。
                const files = Array.from(event.target.files ?? []);
                event.target.value = "";
                acceptFiles(files);
              }}
            />
            <span className="field__hint">{repairEditorCopy.photoDropHint}</span>
          </label>
          <label className="field">
            <span className="field__label">{repairEditorCopy.photoCameraLabel}</span>
            <input
              className="field__input"
              type="file"
              accept={REPAIR_PHOTO_ACCEPT}
              capture="environment"
              disabled={disabled}
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                event.target.value = "";
                acceptFiles(files);
              }}
            />
            <span className="field__hint">{repairEditorCopy.photoCameraHint}</span>
          </label>
          {hint ? <span className="field__hint">{hint}</span> : null}
          {maxFiles !== undefined ? (
            <span className="field__hint">
              {repairEditorCopy.photoSelectedCount
                .replace("{count}", String(photos.length))
                .replace("{max}", String(maxFiles))}
            </span>
          ) : null}
        </div>
      )}
      {photos.length ? (
        <div className="gap-s-4 grid md:grid-cols-2">
          {photos.map((photo, index) => {
            const percent = Math.round(Math.max(0, Math.min(1, photo.progress ?? 0)) * 100);
            const preparedHint = describePreparedPhoto(photo);
            const sizeLabel =
              photo.originalSize !== undefined
                ? formatBytes(photo.originalSize)
                : formatBytes(photo.file.size);
            const removable = canRemove && (!canRemovePhoto || canRemovePhoto(photo));
            return (
              <figure className="gap-s-2 grid" key={photo.id}>
                <Image
                  className="rounded-mid border-line h-56 w-full border object-cover"
                  src={photo.previewUrl}
                  alt={repairEditorCopy.photoPreviewAlt.replace("{index}", String(index + 1))}
                  width={720}
                  height={480}
                  unoptimized
                />
                {photo.status === undefined ? null : (
                  <div className="gap-s-1 grid text-xs" role="status">
                    <span className="text-ink-3">
                      {photo.status === "preparing"
                        ? repairEditorCopy.photoStatusPreparing
                        : photo.status === "uploading"
                          ? repairEditorCopy.photoStatusUploading.replace(
                              "{percent}",
                              String(percent),
                            )
                          : photo.status === "success"
                            ? repairEditorCopy.photoStatusSuccess
                            : photo.status === "error"
                              ? repairEditorCopy.photoStatusError
                              : repairEditorCopy.photoStatusReady}
                      {" · "}
                      {preparedHint ?? sizeLabel}
                    </span>
                    {photo.status === "uploading" ? (
                      <progress
                        className="photo-upload-progress"
                        max={100}
                        value={percent}
                        aria-label={repairEditorCopy.photoStatusUploading.replace(
                          "{percent}",
                          String(percent),
                        )}
                      />
                    ) : null}
                    {photo.status === "error" ? (
                      <span className="admin-status admin-status--error" role="alert">
                        {repairEditorCopy.photoUploadFailed
                          .replace("{name}", photo.file.name)
                          .replace("{reason}", photo.error ?? repairEditorCopy.photoStatusError)}
                      </span>
                    ) : null}
                  </div>
                )}
                <figcaption className="gap-s-2 flex flex-wrap">
                  {removable ? (
                    <Button
                      type="button"
                      disabled={
                        disabled || photo.status === "preparing" || photo.status === "uploading"
                      }
                      aria-label={repairEditorCopy.photoRemoveLabel.replace(
                        "{index}",
                        String(index + 1),
                      )}
                      onClick={() => onRemove?.(photo.id)}
                    >
                      {repairEditorCopy.photoRemove}
                    </Button>
                  ) : null}
                  {photo.status === "error" && onRetry ? (
                    <Button
                      type="button"
                      disabled={disabled}
                      aria-label={repairEditorCopy.photoRetryLabel.replace(
                        "{index}",
                        String(index + 1),
                      )}
                      onClick={() => onRetry(photo.id)}
                    >
                      {repairEditorCopy.photoRetry}
                    </Button>
                  ) : null}
                </figcaption>
              </figure>
            );
          })}
        </div>
      ) : (
        <p className="field__hint">{emptyLabel}</p>
      )}
    </div>
  );
}
