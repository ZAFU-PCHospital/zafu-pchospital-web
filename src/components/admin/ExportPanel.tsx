"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { AdminToast } from "@/components/admin/AdminToast";
import type { AdminToastMessage } from "@/components/admin/AdminToast";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { adminCopy } from "@/config/admin";
import { repairResultLabels, repairStatusLabels } from "@/config/repairs";
import { adminFetch } from "@/features/admin/admin-client";
import { RepairResult, RepairStatus } from "@/types/contracts";
import type { RepairCategoryView, RepairStatus as RepairStatusValue } from "@/types/contracts";

/** 与导出接口共用的筛选字段；顺序即界面顺序。 */
const FILTER_KEYS = [
  "query",
  "status",
  "result",
  "categoryId",
  "repairDateFrom",
  "repairDateTo",
] as const;

/**
 * 数据导出（M6 §67 / 需求 §34）。
 *
 * 用 `fetch` + Blob 而不是直接跳转下载链接：这样失败时能读到 JSON 信封里的稳定错误码
 * （例如超限的 `EXPORT_ROW_LIMIT_EXCEEDED`）并以界面文案呈现，
 * 而不是把一个裸 JSON 错误页甩给用户。成功时再触发一次浏览器下载。
 *
 * **空结果是这里最容易踩的坑**：0 行同样会下载出一个只有表头的文件，
 * 看上去和「功能坏了」没有区别。因此面板会先按同一组筛选条件统计匹配条数
 * （复用列表接口 `GET /api/v1/admin/repairs` 的 `meta.pagination.total`，
 * 不新增后端入口），并在真正提交时读到 `X-Export-Row-Count: 0` 就**不下发文件**、
 * 直接把当时生效的筛选条件摊开给管理员看。
 */
export function ExportPanel() {
  const copy = adminCopy.export;
  const [categories, setCategories] = useState<RepairCategoryView[]>([]);
  const [format, setFormat] = useState("CSV");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<AdminToastMessage | null>(null);
  const [problem, setProblem] = useState("");
  const [preview, setPreview] = useState<{ state: "idle" | "loading" | "ready"; total: number }>({
    state: "loading",
    total: 0,
  });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await adminFetch<RepairCategoryView[]>("/api/v1/repair-categories");
      if (!cancelled && result.ok) setCategories(result.data);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** 统计当前筛选条件命中的条数。列表接口 `pageSize=1`，只取 `total`。 */
  const countMatches = useCallback(
    async (form: HTMLFormElement) => {
      const params = filterParams(form);
      params.set("page", "1");
      params.set("pageSize", "1");
      setPreview((current) => ({ ...current, state: "loading" }));
      const result = await adminFetch<unknown>(`/api/v1/admin/repairs?${params}`);
      setPreview({ state: "ready", total: result.ok ? (result.pagination?.total ?? 0) : 0 });
      if (!result.ok) setProblem(copy.preview.failed.replace("{message}", result.message));
    },
    [copy.preview.failed],
  );

  /** 输入停顿 400ms 再统计，避免每敲一个字都打一次接口。 */
  function schedulePreview(form: HTMLFormElement) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void countMatches(form), 400);
  }

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  /* 进页面先统计一次「不带筛选」的总条数，让管理员立刻知道库里到底有多少可导出数据。 */
  useEffect(() => {
    if (formRef.current) void countMatches(formRef.current);
  }, [countMatches]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const form = event.currentTarget;
    setBusy(true);
    setToast(null);
    setProblem("");
    const params = filterParams(form);
    params.set("format", format.toLowerCase());
    const filters = describeFilters(new FormData(form), categories, copy.filter);
    try {
      const response = await fetch(`/api/v1/admin/repairs/export?${params}`);
      if (!response.ok) {
        const json = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setProblem(json?.error?.message ?? "导出失败，请稍后重试");
        return;
      }
      const count = Number(response.headers.get("X-Export-Row-Count") ?? "0");
      if (count === 0) {
        // 不落空文件：先告诉管理员「为什么是空的」，比给他一个只有表头的表格有用。
        setPreview({ state: "ready", total: 0 });
        setProblem(filters ? copy.emptyFiltered.replace("{filters}", filters) : copy.emptyNoFilter);
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileNameFrom(response.headers.get("Content-Disposition"), format);
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      // 立刻回收会让部分浏览器把刚开始的下载掐断（表现为 0 字节文件），推迟一拍再释放。
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setPreview({ state: "ready", total: count });
      setToast({ text: copy.done.replace("{count}", String(count)), tone: "success" });
    } catch {
      setProblem("网络异常，请检查连接后重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-workspace__content">
      <div className="admin-workspace__header">
        <div>
          <h1 className="admin-workspace__title" id="admin-export-title">
            {copy.title}
          </h1>
          <p className="admin-workspace__lead">{copy.lead}</p>
        </div>
      </div>

      <AdminToast toast={toast} onDismiss={() => setToast(null)} />

      {problem ? (
        <p className="admin-status admin-status--error" role="alert">
          {problem}
        </p>
      ) : null}

      <Card className="admin-panel">
        <form
          ref={formRef}
          method="post"
          className="admin-form"
          onSubmit={submit}
          onChange={(event) => schedulePreview(event.currentTarget)}
          aria-label={copy.title}
        >
          <div className="admin-filters__row">
            <label className="field">
              <span className="field__label">{copy.filter.query}</span>
              <input className="field__input" name="query" maxLength={64} />
            </label>
            <label className="field">
              <span className="field__label">{copy.filter.status}</span>
              <select className="field__input" name="status" defaultValue="">
                <option value="">{copy.filter.all}</option>
                {RepairStatus.map((status) => (
                  <option key={status} value={status}>
                    {repairStatusLabels[status]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">{copy.filter.result}</span>
              <select className="field__input" name="result" defaultValue="">
                <option value="">{copy.filter.all}</option>
                {RepairResult.map((result) => (
                  <option key={result} value={result}>
                    {repairResultLabels[result]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">{copy.filter.category}</span>
              <select className="field__input" name="categoryId" defaultValue="">
                <option value="">{copy.filter.all}</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">{copy.filter.dateFrom}</span>
              <input className="field__input" type="date" name="repairDateFrom" />
            </label>
            <label className="field">
              <span className="field__label">{copy.filter.dateTo}</span>
              <input className="field__input" type="date" name="repairDateTo" />
            </label>
          </div>

          <fieldset className="repair-filters__checks">
            <legend className="field__label">{copy.format.label}</legend>
            <label>
              <input
                className="admin-check"
                type="radio"
                name="format"
                checked={format === "CSV"}
                onChange={() => setFormat("CSV")}
              />
              {copy.format.csv}
            </label>
            <label>
              <input
                className="admin-check"
                type="radio"
                name="format"
                checked={format === "XLSX"}
                onChange={() => setFormat("XLSX")}
              />
              {copy.format.xlsx}
            </label>
          </fieldset>

          <p className="admin-note">{copy.columns}</p>
          <p className="admin-note">{copy.note}</p>

          <div className="signup__actions">
            <Button type="submit" variant="solid" icon="download" disabled={busy}>
              {busy ? "正在生成…" : copy.submit}
            </Button>
            {/* 结果条数直接挂在按钮旁边：它决定按钮按下去有没有意义。 */}
            <span
              className={
                preview.state === "ready" && preview.total === 0
                  ? "admin-status admin-status--error"
                  : "admin-status"
              }
              role="status"
              aria-live="polite"
            >
              {previewLabel(preview, copy.preview)}
            </span>
          </div>
        </form>
      </Card>
    </div>
  );
}

/** 把表单里的筛选字段转成查询串；空值一律不带上，与服务端「未填即不过滤」一致。 */
function filterParams(form: HTMLFormElement): URLSearchParams {
  const data = new FormData(form);
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = data.get(key);
    if (typeof value === "string" && value) params.set(key, value);
  }
  return params;
}

function previewLabel(
  preview: { state: "idle" | "loading" | "ready"; total: number },
  copy: typeof adminCopy.export.preview,
): string {
  if (preview.state !== "ready") return copy.loading;
  return (preview.total === 0 ? copy.zero : copy.count).replace("{count}", String(preview.total));
}

/** 把生效的筛选条件拼成一句人话；全部为空时返回空串（表示「没有任何筛选」）。 */
function describeFilters(
  data: FormData,
  categories: RepairCategoryView[],
  labels: typeof adminCopy.export.filter,
): string {
  const parts: string[] = [];
  const query = data.get("query");
  const status = data.get("status");
  const result = data.get("result");
  const categoryId = data.get("categoryId");
  const from = data.get("repairDateFrom");
  const to = data.get("repairDateTo");
  if (typeof query === "string" && query) parts.push(`${labels.query}「${query}」`);
  if (typeof status === "string" && status)
    parts.push(`${labels.status}「${repairStatusLabels[status as RepairStatusValue]}」`);
  if (typeof result === "string" && result)
    parts.push(`${labels.result}「${repairResultLabels[result as RepairResult]}」`);
  if (typeof categoryId === "string" && categoryId) {
    const name = categories.find((item) => item.id === categoryId)?.name ?? categoryId;
    parts.push(`${labels.category}「${name}」`);
  }
  if (typeof from === "string" && from) parts.push(`${labels.dateFrom} ${from}`);
  if (typeof to === "string" && to) parts.push(`${labels.dateTo} ${to}`);
  return parts.join("、");
}

/** 从 `Content-Disposition` 里取文件名；拿不到就用本地兜底名。 */
function fileNameFrom(header: string | null, format: string): string {
  const utf8 = header?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (utf8) return decodeURIComponent(utf8);
  const plain = header?.match(/filename="([^"]+)"/i)?.[1];
  if (plain) return plain;
  return `repair-records.${format === "XLSX" ? "xlsx" : "csv"}`;
}
