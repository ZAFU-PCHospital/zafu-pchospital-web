"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { AdminModal } from "@/components/admin/AdminModal";
import { RepairRecordComments } from "@/components/admin/RepairRecordComments";
import { AdminToast } from "@/components/admin/AdminToast";
import type { AdminToastMessage, AdminToastTone } from "@/components/admin/AdminToast";
import { Button } from "@/components/ui/Button";
import { adminCopy, adminShared } from "@/config/admin";
import { repairResultLabels, repairStatusLabels } from "@/config/repairs";
import { adminFetch } from "@/features/admin/admin-client";
import { RepairResult } from "@/types/contracts";
import type {
  RepairCategoryView,
  RepairDetailView,
  RepairPhotoView,
  RepairView,
} from "@/types/contracts";

/**
 * 单条维修记录的管理动作（M6 §64）。
 *
 * 五类动作各自调用M2/M6 已有的 Service 入口，不在前端复制任何状态规则：
 * 审核走 `review`、标记走 `updateFlags`、改数据走 `updateRecord`、删除走 `softDelete`。
 * 因此界面这里只负责「收集输入 + 展示结果」，状态合法性全部由服务端判定。
 *
 * 呈现方式是 `AdminModal` 窗口（与成员详情一致）：动作区加两个表单超过一屏，
 * 内联在表格下方时点「详情」看起来像没反应。
 */
export function RepairAdminActions({
  record,
  categories,
  onClose,
  onChanged,
}: {
  record: RepairView;
  categories: RepairCategoryView[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const copy = adminCopy.repairs;
  const [problem, setProblem] = useState("");
  /** 一次性成功反馈：走顶部浮层（层级高于本窗口）；错误留在窗口内。 */
  const [toast, setToast] = useState<AdminToastMessage | null>(null);
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  /** `null` = 还没取回来。照片不在列表接口的载荷里，打开窗口时单独取一次详情。 */
  const [photos, setPhotos] = useState<RepairPhotoView[] | null>(null);
  /** 已经确定读不出字节的照片 id（文件被清理、存储路径变更等）。 */
  const [brokenPhotos, setBrokenPhotos] = useState<string[]>([]);
  const idempotencyKey = useRef(crypto.randomUUID());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // 复用 M2 的记录详情接口（`repair:review` 可读任意记录），不为了照片去改列表契约。
      const result = await adminFetch<RepairDetailView>(`/api/v1/repairs/${record.id}`);
      if (cancelled) return;
      setPhotos(result.ok ? result.data.photos : []);
    })();
    return () => {
      cancelled = true;
    };
  }, [record.id]);

  async function call(
    path: string,
    init: { method?: string; body?: unknown },
    successText: string,
    tone: AdminToastTone = "success",
  ): Promise<boolean> {
    setBusy(true);
    setProblem("");
    setToast(null);
    const result = await adminFetch<unknown>(path, init);
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      return false;
    }
    setToast({ text: successText, tone });
    onChanged();
    return true;
  }

  async function review(decision: "APPROVED" | "REJECTED") {
    if (decision === "REJECTED" && !note.trim()) {
      setProblem(copy.review.rejectHint);
      return;
    }
    const ok = await call(
      `/api/v1/admin/repairs/${record.id}/reviews`,
      {
        method: "POST",
        body: { decision, note: note.trim() || undefined, idempotencyKey: idempotencyKey.current },
      },
      decision === "APPROVED" ? "已审核通过。" : "已退回。",
      // 退回是对这条记录说「不」：操作成功，但用叉表达。
      decision === "APPROVED" ? "success" : "neutral",
    );
    if (ok) {
      idempotencyKey.current = crypto.randomUUID();
      setNote("");
      setRejecting(false);
    }
  }

  async function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    await call(
      `/api/v1/admin/repairs/${record.id}`,
      {
        method: "PATCH",
        body: {
          repairDate: data.repairDate || null,
          durationMinutes: data.durationMinutes === "" ? null : Number(data.durationMinutes),
          categoryId: data.categoryId || null,
          content: data.content || null,
          result: data.result || null,
          remark: data.remark || null,
          version: record.version,
          reason: data.reason ?? "",
        },
      },
      copy.edit.saved,
    );
  }

  async function submitFlags(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await call(
      `/api/v1/admin/repairs/${record.id}/flags`,
      {
        method: "PATCH",
        // 两个标记必须都提交：服务端按整体替换处理，缺字段会直接 400（不会静默清空另一个）。
        body: {
          isDifficult: data.get("isDifficult") === "on",
          isTypical: data.get("isTypical") === "on",
        },
      },
      copy.flags.saved,
    );
  }

  async function submitRemove() {
    if (!reason.trim()) {
      setProblem(copy.removePanel.hint);
      return;
    }
    const ok = await call(
      `/api/v1/admin/repairs/${record.id}`,
      { method: "DELETE", body: { reason } },
      copy.removePanel.done,
      "neutral",
    );
    if (ok) {
      setReason("");
      setRemoving(false);
    }
  }

  return (
    <AdminModal
      title={copy.detail.title}
      subtitle={`${record.member.name} · ${repairStatusLabels[record.status]} · v${record.version}`}
      onClose={onClose}
    >
      {/* 一次性成功反馈走顶部浮层（层级高于本窗口）；错误留在窗口内，便于对照表单修改。 */}
      <AdminToast toast={toast} onDismiss={() => setToast(null)} />

      {problem ? (
        <p className="admin-status admin-status--error" role="alert">
          {problem}
        </p>
      ) : null}

      {/* 审核必须看得到照片：导出只给 URL，列表也不带照片，所以窗口里必须能看。 */}
      <section className="admin-photos">
        <h4 className="admin-panel__title">{copy.detail.photos}</h4>
        {photos === null ? (
          <p className="admin-note">{adminShared.loading}</p>
        ) : photos.length === 0 ? (
          <p className="admin-note">{copy.detail.photosEmpty}</p>
        ) : (
          <ul className="admin-photos__list">
            {photos.map((photo, index) => {
              const label = photo.originalName ?? `照片 ${index + 1}`;
              // 记录还在、文件没了（例如集成测试写在临时目录里的夹具照片），
              // 这时读字节会返回 REPAIR_PHOTO_STORAGE_FAILED：显示占位而不是裂图，
              // 也不给「打开原图」的链接 —— 点进去只会看到一张 JSON 错误页。
              if (brokenPhotos.includes(photo.id))
                return (
                  <li key={photo.id}>
                    <div className="admin-photos__item">
                      <span className="admin-photos__fallback">{copy.detail.photoUnavailable}</span>
                      <span className="admin-photos__meta">{label}</span>
                    </div>
                  </li>
                );
              return (
                <li key={photo.id}>
                  <a
                    className="admin-photos__item"
                    href={photo.contentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Image
                      className="admin-photos__image"
                      src={photo.contentUrl}
                      alt={`维修照片 ${index + 1}`}
                      width={480}
                      height={360}
                      unoptimized
                      onError={() => setBrokenPhotos((current) => [...current, photo.id])}
                    />
                    <span className="admin-photos__meta">{label}</span>
                    <span className="admin-photos__action">{copy.detail.photosOpen}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* 评论：管理端「评论管理」点「所属记录」就是打开这个窗口，
          这里必须能看到该记录的评论，否则「评论挂在哪」永远对不上。 */}
      <RepairRecordComments recordId={record.id} onChanged={onChanged} />

      <div className="admin-actions">
        <Button
          icon="check"
          disabled={busy || record.status !== "PENDING"}
          onClick={() => void review("APPROVED")}
        >
          {copy.action.approve}
        </Button>
        <Button
          disabled={busy || record.status !== "PENDING"}
          onClick={() => setRejecting((value) => !value)}
        >
          {copy.action.reject}
        </Button>
        <Button variant="ghost" onClick={() => setRemoving((value) => !value)}>
          {copy.action.remove}
        </Button>
      </div>

      {rejecting ? (
        <div className="admin-filters">
          <label className="field">
            <span className="field__label">{copy.review.rejectTitle}</span>
            <input
              className="field__input"
              value={note}
              maxLength={2000}
              placeholder={copy.review.notePlaceholder}
              onChange={(event) => setNote(event.currentTarget.value)}
            />
            <span className="field__hint">{copy.review.rejectHint}</span>
          </label>
          <div className="signup__actions">
            <Button disabled={busy} onClick={() => void review("REJECTED")}>
              {copy.review.submit}
            </Button>
            <Button variant="ghost" onClick={() => setRejecting(false)}>
              {copy.review.cancel}
            </Button>
          </div>
        </div>
      ) : null}

      {removing ? (
        <div className="admin-filters">
          <label className="field">
            <span className="field__label">{copy.removePanel.reason}</span>
            <input
              className="field__input"
              value={reason}
              maxLength={2000}
              onChange={(event) => setReason(event.currentTarget.value)}
            />
            <span className="field__hint">{copy.removePanel.hint}</span>
          </label>
          <div className="signup__actions">
            <Button icon="trash" disabled={busy} onClick={() => void submitRemove()}>
              {copy.removePanel.submit}
            </Button>
            <Button variant="ghost" onClick={() => setRemoving(false)}>
              {copy.removePanel.cancel}
            </Button>
          </div>
        </div>
      ) : null}

      <form method="post" className="admin-form" onSubmit={submitEdit} aria-label={copy.edit.title}>
        <h4 className="admin-panel__title">{copy.edit.title}</h4>
        <div className="admin-form__grid">
          <label className="field">
            <span className="field__label">{copy.table.repairDate}</span>
            <input
              className="field__input"
              type="date"
              name="repairDate"
              defaultValue={record.repairDate ?? ""}
            />
          </label>
          <label className="field">
            <span className="field__label">{copy.table.duration}</span>
            <input
              className="field__input"
              type="number"
              name="durationMinutes"
              min={1}
              max={10080}
              defaultValue={record.durationMinutes ?? ""}
            />
          </label>
          <label className="field">
            <span className="field__label">{copy.table.category}</span>
            <select
              className="field__input"
              name="categoryId"
              defaultValue={record.category?.id ?? ""}
            >
              <option value="">未分类</option>
              {/* 记录当前分类即使已停用也要列出来，否则无法「保持原值」。 */}
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
              {record.category && !categories.some((item) => item.id === record.category?.id) ? (
                <option value={record.category.id}>{record.category.name}（已停用）</option>
              ) : null}
            </select>
          </label>
          <label className="field">
            <span className="field__label">{copy.table.result}</span>
            <select className="field__input" name="result" defaultValue={record.result ?? ""}>
              <option value="">未填写</option>
              {RepairResult.map((result) => (
                <option key={result} value={result}>
                  {repairResultLabels[result]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          <span className="field__label">维修内容</span>
          <textarea
            className="field__input min-h-32"
            name="content"
            maxLength={10000}
            defaultValue={record.content ?? ""}
          />
        </label>
        <label className="field">
          <span className="field__label">备注</span>
          <textarea
            className="field__input min-h-24"
            name="remark"
            maxLength={2000}
            defaultValue={record.remark ?? ""}
          />
        </label>
        <label className="field">
          <span className="field__label">{copy.edit.reason}</span>
          <input className="field__input" name="reason" required maxLength={2000} />
          <span className="field__hint">{copy.edit.reasonHint}</span>
        </label>
        <div className="signup__actions">
          <Button type="submit" variant="solid" icon="edit" disabled={busy}>
            {busy ? adminShared.submitting : copy.edit.submit}
          </Button>
        </div>
      </form>

      <form method="post" className="admin-form" onSubmit={submitFlags} aria-label={copy.flags.title}>
        <h4 className="admin-panel__title">{copy.flags.title}</h4>
        <div className="repair-filters__checks">
          <label>
            <input
              className="admin-check"
              type="checkbox"
              name="isDifficult"
              defaultChecked={record.isDifficult}
            />
            {copy.flags.difficult}
          </label>
          <label>
            <input
              className="admin-check"
              type="checkbox"
              name="isTypical"
              defaultChecked={record.isTypical}
            />
            {copy.flags.typical}
          </label>
        </div>
        <div className="signup__actions">
          <Button type="submit" disabled={busy}>
            {copy.flags.submit}
          </Button>
        </div>
      </form>
    </AdminModal>
  );
}
