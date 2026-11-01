"use client";

import { useEffect, useState } from "react";

import { RepairPhotoGallery } from "@/components/repairs/RepairPhotoGallery";
import { Button } from "@/components/ui/Button";
import { formatBytes, repairCopy, repairEditorCopy } from "@/config/repairs";
import { normalizePhotoViewOrder } from "@/components/repairs/photo-order";
import type { RepairPhotoView } from "@/types/contracts";

type Props = {
  recordId: string;
  photos: RepairPhotoView[];
  limits: { maxBytes: number; maxFiles: number };
  canAttach: boolean;
  onChange: (photos: RepairPhotoView[]) => void;
};

/**
 * 维修详情里的照片附件。
 *
 * 记录本人在「提交后、审核前」也可以补传 / 排序 / 删除；权限窗口由服务端
 * `canAttachPhotos` 下发，写接口仍会独立复核。审核通过后这里自动变成只读。
 */
export function RepairPhotoAttachments({ recordId, photos, limits, canAttach, onChange }: Props) {
  const [items, setItems] = useState(photos);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setItems(photos);
  }, [photos, recordId]);

  function update(next: RepairPhotoView[]) {
    // 列表顺序就是展示顺序；写操作成功后统一收敛为 0..n-1，避免本地保留
    // 删除留下的空洞或重复 sortOrder，后续上传 / 换序再按旧值排序时跳位。
    const normalized = normalizePhotoViewOrder(next);
    setItems(normalized);
    onChange(normalized);
  }

  async function upload(files: File[]) {
    if (!files.length || busy) return;
    setMessage("");
    if (items.length + files.length > limits.maxFiles) {
      setMessage(
        repairEditorCopy.photoTooMany
          .replace("{count}", String(items.length))
          .replace("{remain}", String(Math.max(limits.maxFiles - items.length, 0))),
      );
      return;
    }
    const oversized = files.find((file) => file.size > limits.maxBytes);
    if (oversized) {
      setMessage(
        repairEditorCopy.photoTooLarge
          .replace("{name}", oversized.name)
          .replace("{size}", formatBytes(oversized.size))
          .replace("{limit}", formatBytes(limits.maxBytes)),
      );
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      files.forEach((file) => form.append("photos", file));
      const response = await fetch(`/api/v1/repairs/${recordId}/photos`, {
        method: "POST",
        body: form,
      });
      const json = await response.json();
      if (!json.success) throw new Error(json.error.message);
      const created = json.data as RepairPhotoView[];
      update([...items, ...created].sort((a, b) => a.sortOrder - b.sortOrder));
      setMessage("照片已上传。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "上传失败");
    } finally {
      setBusy(false);
    }
  }

  async function remove(photoId: string) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/v1/repairs/${recordId}/photos/${photoId}`, {
        method: "DELETE",
      });
      const json = await response.json();
      if (!json.success) throw new Error(json.error.message);
      update(items.filter((item) => item.id !== photoId));
      setMessage("照片已移除。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "移除失败");
    } finally {
      setBusy(false);
    }
  }

  async function reorder(photoId: string, sortOrder: number) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/v1/repairs/${recordId}/photos/${photoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sortOrder }),
      });
      const json = await response.json();
      if (!json.success) throw new Error(json.error.message);
      const from = items.findIndex((item) => item.id === photoId);
      if (from >= 0 && from !== sortOrder) {
        // 服务端按目标位置移动并重排 0..n-1；本地也按显示位置互换，
        // 再交给 update 统一收敛序号，避免整页重载丢焦点。
        const next = [...items];
        [next[from], next[sortOrder]] = [next[sortOrder], next[from]];
        update(next);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "排序失败");
    } finally {
      setBusy(false);
    }
  }

  const hint = repairCopy.detail.pendingPhotoHint
    .replace("{count}", String(limits.maxFiles))
    .replace("{size}", formatBytes(limits.maxBytes));

  return (
    <div className="gap-s-3 grid">
      {canAttach ? (
        <label className="field">
          <span className="field__label">补充照片</span>
          <input
            className="field__input"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            disabled={busy}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              void upload(files);
            }}
          />
          <span className="field__hint">{hint}</span>
        </label>
      ) : null}
      <p className="text-ink-3 text-sm" role="status" aria-live="polite">
        {message}
      </p>
      {items.length ? (
        <RepairPhotoGallery
          photos={items}
          renderActions={
            canAttach
              ? (photo, index) => (
                  <>
                    <Button
                      disabled={busy || index === 0}
                      onClick={() => void reorder(photo.id, index - 1)}
                    >
                      前移
                    </Button>
                    <Button
                      disabled={busy || index === items.length - 1}
                      onClick={() => void reorder(photo.id, index + 1)}
                    >
                      后移
                    </Button>
                    <Button disabled={busy} onClick={() => void remove(photo.id)}>
                      移除
                    </Button>
                  </>
                )
              : undefined
          }
        />
      ) : (
        <p>{canAttach ? repairCopy.detail.pendingPhotoEmpty : repairCopy.detail.photoEmpty}</p>
      )}
    </div>
  );
}
