"use client";

import Image from "next/image";

import { Button } from "@/components/ui/Button";
import { repairEditorCopy } from "@/config/repairs";

import { REPAIR_PHOTO_ACCEPT } from "./photo-selection";

export type PendingPhoto = {
  id: string;
  file: File;
  previewUrl: string;
};

type Props = {
  photos: PendingPhoto[];
  hint?: string;
  disabled?: boolean;
  readOnly?: boolean;
  /** 只读场景仍允许移除（例如建单后照片上传失败，先删掉有问题的照片再重试）。 */
  allowRemove?: boolean;
  emptyLabel: string;
  onAdd?: (files: File[]) => void;
  onRemove?: (id: string) => void;
};

/** 新建维修记录在提交前暂存的本地照片：只做预览 / 移除，确认提交后才上传。 */
export function PendingPhotoPicker({
  photos,
  hint,
  disabled,
  readOnly,
  allowRemove,
  emptyLabel,
  onAdd,
  onRemove,
}: Props) {
  const canRemove = !readOnly || allowRemove === true;
  return (
    <div className="gap-s-3 grid">
      {readOnly ? null : (
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
              onAdd?.(files);
            }}
          />
          {hint ? <span className="field__hint">{hint}</span> : null}
        </label>
      )}
      {photos.length ? (
        <div className="gap-s-4 grid md:grid-cols-2">
          {photos.map((photo, index) => (
            <figure className="gap-s-2 grid" key={photo.id}>
              <Image
                className="rounded-mid border-line h-56 w-full border object-cover"
                src={photo.previewUrl}
                alt={repairEditorCopy.photoPreviewAlt.replace("{index}", String(index + 1))}
                width={720}
                height={480}
                unoptimized
              />
              {canRemove ? (
                <figcaption className="gap-s-2 flex flex-wrap">
                  <Button
                    type="button"
                    disabled={disabled}
                    aria-label={repairEditorCopy.photoRemoveLabel.replace(
                      "{index}",
                      String(index + 1),
                    )}
                    onClick={() => onRemove?.(photo.id)}
                  >
                    {repairEditorCopy.photoRemove}
                  </Button>
                </figcaption>
              ) : null}
            </figure>
          ))}
        </div>
      ) : (
        <p className="field__hint">{emptyLabel}</p>
      )}
    </div>
  );
}
