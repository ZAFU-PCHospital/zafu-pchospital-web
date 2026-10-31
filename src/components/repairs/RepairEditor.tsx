"use client";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { AdminToast, type AdminToastMessage } from "@/components/admin/AdminToast";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { RepairParticipantPicker } from "@/components/ui/RepairParticipantPicker";
import {
  defaultRepairResult,
  formatBytes,
  repairEditorCopy,
  repairFieldLimits,
  repairResultLabels,
} from "@/config/repairs";
import { parseRepairDate, validateSubmission } from "@/features/repairs/repair-validation";
import { AppError } from "@/lib/api/errors";
import { shanghaiToday } from "@/lib/shanghai-date";
import { createIdempotencyKey } from "@/lib/idempotency-key";
import type {
  RepairCategoryView,
  RepairDetailView,
  RepairMemberOption,
  RepairParticipantView,
} from "@/types/contracts";
import {
  clearCreateDraft,
  hasCreateDraftContent,
  mergeServePrefill,
  readCreateDraft,
  writeCreateDraft,
  type CreateDraftSnapshot,
} from "./create-draft-storage";
import { PendingPhotoPicker, type PendingPhoto } from "./PendingPhotoPicker";
import { formatPhotoSelectionError, validatePhotoSelection } from "./photo-selection";
import { RepairCreateSummary } from "./RepairCreateSummary";

/** 点击整块日期输入框都弹出原生日历（默认只有右侧小图标会弹）。 */
function openDatePicker(event: ReactMouseEvent<HTMLInputElement>) {
  try {
    event.currentTarget.showPicker();
  } catch {
    // 浏览器拒绝时（非用户手势、选择器已打开）忽略：原生点击行为不受影响。
  }
}

type CreateStep = "edit" | "confirm";

/** 新建页由服务端下发真实上限；缺省值只用于编辑页或测试，不会出现在正常新建流程。 */
const FALLBACK_PHOTO_LIMITS = {
  maxBytes: Number.POSITIVE_INFINITY,
  maxFiles: Number.POSITIVE_INFINITY,
};

/** 第一步校验失败时，把焦点送到第一个出错的字段，而不是让用户自己去顶部找。 */
const CREATE_FIELD_SELECTORS: Record<string, string> = {
  repairDate: 'input[type="date"]',
  durationMinutes: 'input[type="number"]',
  categoryId: "select",
  ownerName: 'input[aria-describedby="repair-owner-name-hint"]',
  ownerPhone: 'input[type="tel"]',
  deviceModel: 'input[aria-describedby="repair-device-model-hint"]',
};

/**
 * 新建页的本地初始记录：没有服务端 ID / 版本，照片为空。
 * 照片上限由服务端页面传入，提交后才上传。
 */
function localDraftRecord(input: {
  creator: { id: string; name: string };
  categories: RepairCategoryView[];
  participants: RepairParticipantView[];
  stored: CreateDraftSnapshot | null;
  photoLimits: { maxBytes: number; maxFiles: number };
}): RepairDetailView {
  const now = new Date().toISOString();
  const categoryId = input.stored?.categoryId ?? null;
  return {
    id: "",
    member: input.creator,
    participants: [input.creator, ...input.participants],
    repairDate: input.stored?.repairDate ?? shanghaiToday(),
    durationMinutes: input.stored?.durationMinutes ?? null,
    category: categoryId ? (input.categories.find((item) => item.id === categoryId) ?? null) : null,
    deviceModel: input.stored?.deviceModel ?? null,
    ownerName: input.stored?.ownerName ?? null,
    ownerPhone: input.stored?.ownerPhone ?? null,
    content: null,
    result: defaultRepairResult,
    remark: input.stored?.remark ?? null,
    status: "DRAFT",
    isDifficult: false,
    isTypical: false,
    version: 0,
    submittedAt: null,
    reviewedAt: null,
    createdAt: now,
    updatedAt: now,
    photos: [],
    reviews: [],
    timeline: [],
    canEdit: true,
    canAttachPhotos: true,
    canReview: false,
    canFlag: false,
    isFavorited: false,
    photoLimits: input.photoLimits,
  };
}

/**
 * 活动接待「继续填写」的本地初始记录：
 * 本机暂存优先，其余字段从登记行 / 活动预填。
 */
function serveDraftRecord(input: {
  creator: { id: string; name: string };
  categories: RepairCategoryView[];
  participants: RepairParticipantView[];
  stored: CreateDraftSnapshot | null;
  photoLimits: { maxBytes: number; maxFiles: number };
  prefill: {
    name: string;
    phone: string;
    deviceModel: string | null;
    categoryId: string | null;
    repairDate: string;
  };
}): RepairDetailView {
  return localDraftRecord({
    ...input,
    stored: mergeServePrefill(input.stored, input.prefill),
  });
}

/** 只把非图片字段写进暂存；参与人排除创建人本人。 */
function snapshotOf(record: RepairDetailView): CreateDraftSnapshot {
  return {
    repairDate: record.repairDate,
    durationMinutes: record.durationMinutes,
    categoryId: record.category?.id ?? null,
    ownerName: record.ownerName,
    ownerPhone: record.ownerPhone,
    deviceModel: record.deviceModel,
    remark: record.remark,
    participantIds: record.participants
      .filter((participant) => participant.id !== record.member.id)
      .map((participant) => participant.id),
  };
}

type EditorRouter = {
  push: (href: string) => void;
  replace: (href: string) => void;
};

export type RepairEditorProps = {
  /**
   * 编辑既有记录时传 ID；新建页**不传**：表单先在本地填写，提交时才建档。
   */
  recordId?: string;
  /** 新建流程不再暴露「草稿」：只留提交审核；编辑存量草稿与退回记录仍可保存。 */
  allowSaveDraft?: boolean;
  /** 从活动看板进入时，提交成功后返回该看板继续接待。 */
  returnActivityId?: string;
  /** 活动接待「继续填写」：预填来自登记行，提交时创建维修单并关联接待。 */
  serveContext?: { activityId: string; registrationId: string };
  /** 新建页照片上限：由服务端 `uploadLimits()` 下发，提交前用于本地拦截。 */
  photoLimits?: { maxBytes: number; maxFiles: number };
};

/** 路由在入口注入；视图本身不依赖 next/navigation，便于用假路由做行为测试。 */
export function RepairEditor(props: RepairEditorProps) {
  const router = useRouter();
  return <RepairEditorView {...props} router={router} />;
}

export function RepairEditorView({
  recordId,
  allowSaveDraft = true,
  returnActivityId,
  serveContext,
  photoLimits,
  router,
}: RepairEditorProps & { router: EditorRouter }) {
  const createMode = !recordId;
  /** 活动接待补单的本地暂存按报名分桶。 */
  const draftScope = serveContext?.registrationId;
  const serverId = recordId ?? "";
  /** 新建会话的幂等键：重复点提交 / 上传重试都不会多建草稿。 */
  const [createRequestKey] = useState(createIdempotencyKey);
  const [record, setRecord] = useState<RepairDetailView>();
  const [categories, setCategories] = useState<RepairCategoryView[]>([]);
  /**
   * 参与维修人员的候选名单：普通场景为全部活跃成员；
   * 活动接待建单改用预填接口下发的本场出勤成员。
   */
  const [memberOptions, setMemberOptions] = useState<RepairMemberOption[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error" | "forbidden" | "serveError">(
    "loading",
  );
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [toast, setToast] = useState<AdminToastMessage | null>(null);
  const [createStep, setCreateStep] = useState<CreateStep>("edit");
  const [pendingPhotos, setPendingPhotos] = useState<PendingPhoto[]>([]);
  const [createdRecordId, setCreatedRecordId] = useState<string | null>(null);
  const confirmHeadingRef = useRef<HTMLHeadingElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const pendingPhotosRef = useRef<PendingPhoto[]>([]);
  /** 确认 / 重试上传的同步防连点：busy 重新渲染前也可能被点第二次。 */
  const createSubmittingRef = useRef(false);
  useEffect(() => {
    if (!submitted || !returnActivityId) return;
    const timer = setTimeout(() => {
      router.replace(`/member/repair-activities/${encodeURIComponent(returnActivityId)}`);
    }, 1000);
    return () => clearTimeout(timer);
  }, [submitted, returnActivityId, router]);
  useEffect(() => {
    pendingPhotosRef.current = pendingPhotos;
  }, [pendingPhotos]);
  useEffect(() => {
    return () => {
      pendingPhotosRef.current.forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
    };
  }, []);
  useEffect(() => {
    if (createStep === "confirm") confirmHeadingRef.current?.focus();
  }, [createStep]);
  const load = useCallback(async () => {
    setState("loading");
    try {
      if (!serverId) {
        // 活动接待由预填接口一并返回本场出勤候选；其他新建场景仍用全局名册。
        const candidateUrl = serveContext
          ? `/api/v1/member/repair-activities/${serveContext.activityId}/registrations/${serveContext.registrationId}/prefill`
          : "/api/v1/repair-members";
        const [catsResponse, meResponse, candidateResponse] = await Promise.all([
          fetch("/api/v1/repair-categories", { cache: "no-store" }),
          fetch("/api/v1/me", { cache: "no-store" }),
          fetch(candidateUrl, { cache: "no-store" }),
        ]);
        const cats = await catsResponse.json();
        const me = await meResponse.json();
        const candidate = await candidateResponse.json();
        if (!me.success || typeof me.data?.memberProfileId !== "string") {
          setState("error");
          return;
        }
        const categories: RepairCategoryView[] = cats.success ? cats.data : [];
        const creator = {
          id: me.data.memberProfileId as string,
          name: (me.data.displayName as string | null) ?? "我",
        };
        setCategories(categories);
        if (serveContext) {
          if (!candidate.success) {
            setMessage(candidate.error?.message ?? "无法读取这条接待的预填信息。");
            setState("serveError");
            return;
          }
          const options: RepairMemberOption[] = candidate.data.participantOptions ?? [];
          const stored = readCreateDraft(draftScope);
          const wanted = new Set(stored?.participantIds ?? []);
          const participants = options
            .filter((option) => wanted.has(option.id) && option.id !== creator.id)
            .map((option) => ({ id: option.id, name: option.name }));
          setMemberOptions(options);
          setRecord(
            serveDraftRecord({
              creator,
              categories,
              participants,
              stored,
              photoLimits: photoLimits ?? FALLBACK_PHOTO_LIMITS,
              prefill: candidate.data,
            }),
          );
          if (stored && hasCreateDraftContent(stored))
            setMessage(repairEditorCopy.createDraftRestored);
          setState("ready");
          return;
        }
        const options: RepairMemberOption[] = candidate.success ? candidate.data : [];
        const stored = readCreateDraft();
        const wanted = new Set(stored?.participantIds ?? []);
        const participants = options
          .filter((option) => wanted.has(option.id) && option.id !== creator.id)
          .map((option) => ({ id: option.id, name: option.name }));
        setMemberOptions(options);
        setRecord(
          localDraftRecord({
            creator,
            categories,
            participants,
            stored,
            photoLimits: photoLimits ?? FALLBACK_PHOTO_LIMITS,
          }),
        );
        if (stored && hasCreateDraftContent(stored))
          setMessage(repairEditorCopy.createDraftRestored);
        setState("ready");
        return;
      }
      const [a, b, c] = await Promise.all([
        fetch(`/api/v1/repairs/${serverId}`, { cache: "no-store" }),
        fetch("/api/v1/repair-categories", { cache: "no-store" }),
        fetch("/api/v1/repair-members", { cache: "no-store" }),
      ]);
      const detail = await a.json();
      const cats = await b.json();
      const members = await c.json();
      if (members.success) setMemberOptions(members.data);
      if (!detail.success) {
        setState(
          detail.error.code === "REPAIR_FORBIDDEN" || detail.error.code === "REPAIR_NOT_FOUND"
            ? "forbidden"
            : "error",
        );
        return;
      }
      if (!detail.data.canEdit) {
        setState("forbidden");
        return;
      }
      // 「不填默认今天」：空值（含更早留下的草稿）打开时即按今天显示，
      // 保存或提交那一刻才真正写进库。
      setRecord(
        detail.data.repairDate === null
          ? { ...detail.data, repairDate: shanghaiToday() }
          : detail.data,
      );
      setCategories(cats.success ? cats.data : []);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [serverId, serveContext, draftScope, photoLimits]);
  useEffect(() => {
    void load();
  }, [load]);
  // 新建页：非图片字段随时写进 sessionStorage；有内容时关闭 / 刷新给出浏览器提醒。
  useEffect(() => {
    if (!createMode || serverId || !record) return;
    const snapshot = snapshotOf(record);
    if (hasCreateDraftContent(snapshot)) writeCreateDraft(snapshot, draftScope);
    else clearCreateDraft(draftScope);
  }, [createMode, serverId, record, draftScope]);
  useEffect(() => {
    if (!createMode || serverId || !record) return;
    if (!hasCreateDraftContent(snapshotOf(record)) && pendingPhotos.length === 0) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [createMode, serverId, record, pendingPhotos.length]);
  function field<K extends keyof RepairDetailView>(key: K, value: RepairDetailView[K]) {
    setRecord((current) => (current ? { ...current, [key]: value } : current));
  }
  function addPendingPhotos(files: File[]) {
    if (!record || files.length === 0) return;
    const error = validatePhotoSelection(files, pendingPhotos.length, record.photoLimits);
    if (error) {
      setMessage(formatPhotoSelectionError(error));
      return;
    }
    const additions = files.map((file) => ({
      id: createIdempotencyKey(),
      file,
      previewUrl: URL.createObjectURL(file),
    }));
    setPendingPhotos((current) => [...current, ...additions]);
    setMessage("");
  }
  function removePendingPhoto(id: string) {
    const target = pendingPhotos.find((photo) => photo.id === id);
    if (target) URL.revokeObjectURL(target.previewUrl);
    setPendingPhotos((current) => current.filter((photo) => photo.id !== id));
    setMessage("");
  }
  function clearPendingPhotos() {
    pendingPhotosRef.current.forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
    pendingPhotosRef.current = [];
    setPendingPhotos([]);
  }
  /** 新建页第一步 → 第二步：先用与服务端同源的规则挡住明显缺项。 */
  function goToConfirm() {
    if (!record) return;
    try {
      validateSubmission({
        repairDate: parseRepairDate(record.repairDate) ?? null,
        durationMinutes: record.durationMinutes ?? null,
        categoryId: record.category?.id ?? null,
        ownerName: record.ownerName,
        ownerPhone: record.ownerPhone,
        deviceModel: record.deviceModel,
        content: record.content,
        result: record.result,
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "请补全必填项");
      const fieldKey =
        error instanceof AppError ? Object.keys(error.fieldErrors ?? {})[0] : undefined;
      const selector = fieldKey ? CREATE_FIELD_SELECTORS[fieldKey] : undefined;
      const field = selector ? formRef.current?.querySelector<HTMLElement>(selector) : null;
      field?.focus({ preventScroll: true });
      field?.scrollIntoView({ block: "center" });
      return;
    }
    setMessage("");
    setCreateStep("confirm");
  }
  function goBackToEdit() {
    setMessage("");
    setCreateStep("edit");
    setTimeout(() => formRef.current?.focus({ preventScroll: true }), 0);
  }
  /** 保存当前表单，返回服务端视图 —— `PATCH` 返回的是列表视图（无 `reviews` / `timeline`），故用合并。 */
  /** 表单字段 → 新建 / 补单请求体（两处共用）。 */
  function draftFieldsOf(current: RepairDetailView) {
    return {
      repairDate: current.repairDate,
      durationMinutes: current.durationMinutes ?? null,
      categoryId: current.category?.id ?? null,
      ownerName: current.ownerName,
      ownerPhone: current.ownerPhone,
      deviceModel: current.deviceModel,
      // 不再发送 `content`：字段已从表单退场，`undefined` 即「不动」——
      // 老记录的正文不会被这里清空。
      remark: current.remark,
      result: current.result ?? defaultRepairResult,
      // 参与维修人员：只发送额外成员（不含创建人本人），服务端整体替换。
      participantIds: current.participants
        .filter((participant) => participant.id !== current.member.id)
        .map((participant) => participant.id),
    };
  }
  async function persist(): Promise<RepairDetailView> {
    if (!record) throw new Error("记录尚未加载");
    if (createMode) throw new Error("新建记录请直接提交，不保存草稿。");
    const fields = draftFieldsOf(record);
    const response = await fetch(`/api/v1/repairs/${serverId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: record.version, ...fields }),
    });
    const json = await response.json();
    if (!json.success) throw new Error(json.error.message);
    setRecord((current) => (current ? { ...current, ...json.data } : json.data));
    return json.data as RepairDetailView;
  }
  async function save() {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      await persist();
      setMessage("草稿已保存。");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }
  /** 接待补单：创建 PENDING 记录并关联登记，返回记录 ID（照片随后上传）。 */
  async function createServeRecord(): Promise<string> {
    if (!record || !serveContext) throw new Error("接待信息缺失，请返回活动重试");
    const response = await fetch(
      `/api/v1/member/repair-activities/${serveContext.activityId}/registrations/${serveContext.registrationId}/record`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": createRequestKey },
        body: JSON.stringify(draftFieldsOf(record)),
      },
    );
    const json = await response.json();
    if (!json.success) {
      const fieldErrors = json.error.fieldErrors
        ? Object.values(json.error.fieldErrors).flat().join("；")
        : "";
      throw new Error(fieldErrors || json.error.message);
    }
    return json.data.id as string;
  }

  /** 「暂存返回」：只存本机 sessionStorage，不创建服务端草稿。 */
  function saveAndReturn() {
    if (!record || !serveContext) return;
    writeCreateDraft(snapshotOf(record), draftScope);
    router.push(`/member/repair-activities/${encodeURIComponent(serveContext.activityId)}`);
  }

  /** 新建「提交即建单」：创建 PENDING 记录，返回记录 ID（照片随后上传）。 */
  async function createRepairRecord(): Promise<string> {
    if (!record) throw new Error("记录尚未加载");
    const response = await fetch("/api/v1/repairs", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": createRequestKey },
      body: JSON.stringify(draftFieldsOf(record)),
    });
    const json = await response.json();
    if (!json.success) {
      const fieldErrors = json.error.fieldErrors
        ? Object.values(json.error.fieldErrors).flat().join("；")
        : "";
      throw new Error(fieldErrors || json.error.message);
    }
    return json.data.id as string;
  }

  /** 记录已创建后一次性批量上传暂存照片；失败时保留文件供重试。 */
  async function uploadPendingPhotos(recordId: string): Promise<void> {
    if (pendingPhotos.length === 0) return;
    const form = new FormData();
    pendingPhotos.forEach((photo) => form.append("photos", photo.file));
    const response = await fetch(`/api/v1/repairs/${recordId}/photos`, {
      method: "POST",
      body: form,
    });
    const json = await response.json();
    if (!json.success) throw new Error(json.error?.message ?? "照片上传失败");
  }

  function completeCreate(recordId: string) {
    clearCreateDraft(draftScope);
    clearPendingPhotos();
    if (returnActivityId) {
      setToast({ text: repairEditorCopy.activitySubmitSuccess, tone: "success" });
      setSubmitted(true);
    } else {
      router.replace(`/member/repairs/${recordId}`);
    }
  }

  /** 确认步骤：先建单，再上传照片；建单成功后失败只重试上传，不重复建单。 */
  async function confirmCreate() {
    if (busy || createSubmittingRef.current || !record) return;
    createSubmittingRef.current = true;
    setBusy(true);
    setMessage("");
    let recordId = createdRecordId;
    try {
      if (!recordId) {
        recordId = serveContext ? await createServeRecord() : await createRepairRecord();
        setCreatedRecordId(recordId);
      }
      if (pendingPhotos.length) await uploadPendingPhotos(recordId);
      completeCreate(recordId);
    } catch (error) {
      const text = error instanceof Error ? error.message : "提交失败";
      setMessage(
        recordId ? repairEditorCopy.recordCreatedUploadFailed.replace("{message}", text) : text,
      );
    } finally {
      createSubmittingRef.current = false;
      setBusy(false);
    }
  }

  async function retryUpload() {
    if (busy || createSubmittingRef.current || !createdRecordId) return;
    createSubmittingRef.current = true;
    setBusy(true);
    setMessage("");
    try {
      await uploadPendingPhotos(createdRecordId);
      completeCreate(createdRecordId);
    } catch (error) {
      setMessage(
        repairEditorCopy.recordCreatedUploadFailed.replace(
          "{message}",
          error instanceof Error ? error.message : "照片上传失败",
        ),
      );
    } finally {
      createSubmittingRef.current = false;
      setBusy(false);
    }
  }

  function goToRecordDetail() {
    if (!createdRecordId) return;
    clearCreateDraft(draftScope);
    clearPendingPhotos();
    router.replace(`/member/repairs/${createdRecordId}`);
  }

  async function submit() {
    if (busy) return;
    // 机型提交必填：先在客户端给出可读提示，服务端还会再校验一次。
    if (!record?.deviceModel?.trim()) {
      setMessage(repairEditorCopy.deviceModelRequired);
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      // 先把当前表单存一次再提交：否则「填了但没保存」会被服务端的完整性校验拦下。
      const idempotencyKey = createIdempotencyKey();
      const saved = await persist();
      const response = await fetch(`/api/v1/repairs/${saved.id}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ version: saved.version }),
      });
      const json = await response.json();
      if (!json.success) {
        const fields = json.error.fieldErrors
          ? Object.values(json.error.fieldErrors).flat().join("；")
          : "";
        throw new Error(fields || json.error.message);
      }
      clearCreateDraft(draftScope);
      if (returnActivityId) {
        setToast({ text: repairEditorCopy.activitySubmitSuccess, tone: "success" });
        setSubmitted(true);
      } else {
        router.replace(`/member/repairs/${saved.id}`);
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "提交失败");
      setBusy(false);
    }
  }
  /** 添加参与成员：创建人固定第一行、不可移除；候选里排除已加入的人。 */
  function addParticipant(memberProfileId: string) {
    if (!record || !memberProfileId) return;
    setRecord((current) => {
      if (!current) return current;
      const member = memberOptions.find((option) => option.id === memberProfileId);
      if (!member || current.participants.some((item) => item.id === memberProfileId))
        return current;
      if (current.participants.length >= repairFieldLimits.participantMaxCount) return current;
      return {
        ...current,
        participants: [...current.participants, { id: member.id, name: member.name }],
      };
    });
  }
  function removeParticipant(memberProfileId: string) {
    setRecord((current) =>
      current
        ? {
            ...current,
            participants: current.participants.filter((item) => item.id !== memberProfileId),
          }
        : current,
    );
  }
  /** 照片是即时保存的，只合并照片 —— 整块重载会丢掉表单里还没保存的改动。 */
  async function refreshPhotos(targetId: string) {
    const response = await fetch(`/api/v1/repairs/${targetId}`, { cache: "no-store" });
    const json = await response.json();
    if (!json.success) return;
    setRecord((current) => (current ? { ...current, photos: json.data.photos } : current));
  }
  async function upload(files: File[]) {
    // 新建/接待补单提交前没有记录，照片入口已在界面隐藏。
    if (createMode) return;
    if (!files.length || !record) return;
    const selected = files;
    setBusy(true);
    setMessage("");
    try {
      const targetId = serverId;
      const current = record;
      const { maxBytes, maxFiles } = current.photoLimits;
      // 按服务端下发的上限拦一遍：超限的文件根本传不上去，不必等 multipart 走完再说。
      const oversized = selected.find((file) => file.size > maxBytes);
      if (oversized) {
        setMessage(
          repairEditorCopy.photoTooLarge
            .replace("{name}", oversized.name)
            .replace("{size}", formatBytes(oversized.size))
            .replace("{limit}", formatBytes(maxBytes)),
        );
        return;
      }
      if (current.photos.length + selected.length > maxFiles) {
        setMessage(
          repairEditorCopy.photoTooMany
            .replace("{count}", String(current.photos.length))
            .replace("{remain}", String(Math.max(maxFiles - current.photos.length, 0))),
        );
        return;
      }
      const form = new FormData();
      selected.forEach((file) => form.append("photos", file));
      const response = await fetch(`/api/v1/repairs/${targetId}/photos`, {
        method: "POST",
        body: form,
      });
      const json = await response.json();
      if (!json.success) throw new Error(json.error.message);
      await refreshPhotos(targetId);
      setMessage("照片已上传。");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "上传失败");
    } finally {
      setBusy(false);
    }
  }
  async function remove(photoId: string) {
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/repairs/${recordId}/photos/${photoId}`, {
        method: "DELETE",
      });
      const json = await response.json();
      if (!json.success) throw new Error(json.error.message);
      await refreshPhotos(serverId);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "移除失败");
    } finally {
      setBusy(false);
    }
  }
  async function reorder(photoId: string, sortOrder: number) {
    await fetch(`/api/v1/repairs/${recordId}/photos/${photoId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sortOrder }),
    });
    await refreshPhotos(serverId);
  }
  if (state === "loading") return <p role="status">正在加载表单…</p>;
  if (state === "error")
    return (
      <Card variant="notice">
        <p>记录加载失败。</p>
        <Button onClick={() => void load()}>重试</Button>
      </Card>
    );
  if (state === "forbidden")
    return (
      <Card variant="notice">
        <p>这条记录不存在，或当前状态不允许编辑。</p>
        <Button href="/member/repairs">返回列表</Button>
      </Card>
    );
  if (state === "serveError")
    return (
      <Card variant="notice">
        <p>{message || "无法读取这条接待的预填信息。"}</p>
        <Button
          href={
            serveContext
              ? `/member/repair-activities/${serveContext.activityId}`
              : "/member/repairs"
          }
        >
          返回活动
        </Button>
      </Card>
    );
  if (!record) return null;
  const rejection = [...record.reviews].reverse().find((item) => item.decision === "REJECTED");
  const photoHint = repairEditorCopy.photoHint
    .replace("{size}", formatBytes(record.photoLimits.maxBytes))
    .replace("{count}", String(record.photoLimits.maxFiles));
  const createPhotoHint = repairEditorCopy.photoCreateHint
    .replace("{size}", formatBytes(record.photoLimits.maxBytes))
    .replace("{count}", String(record.photoLimits.maxFiles));

  if (createMode && createStep === "confirm") {
    return (
      <div className="repair-editor">
        <AdminToast toast={toast} onDismiss={() => setToast(null)} />
        <Card className="repair-panel">
          <h2
            ref={confirmHeadingRef}
            id="repair-create-confirm-title"
            tabIndex={-1}
            className="text-display-3 font-bold"
          >
            {repairEditorCopy.confirmTitle}
          </h2>
          <p className="muted">{repairEditorCopy.confirmIntro}</p>
          <RepairCreateSummary
            record={record}
            photos={pendingPhotos}
            serveContext={Boolean(serveContext)}
            onRemovePhoto={createdRecordId && !busy ? removePendingPhoto : undefined}
          />
          {message ? (
            <p className="signup__status signup__status--alert" role="alert">
              {message}
            </p>
          ) : null}
          <div className="signup__actions">
            {createdRecordId ? (
              <>
                {pendingPhotos.length ? (
                  <Button
                    type="button"
                    variant="solid"
                    disabled={busy}
                    onClick={() => void retryUpload()}
                  >
                    {busy ? repairEditorCopy.submitting : repairEditorCopy.retryUpload}
                  </Button>
                ) : null}
                <Button type="button" disabled={busy} onClick={goToRecordDetail}>
                  {repairEditorCopy.goToDetail}
                </Button>
              </>
            ) : (
              <>
                <Button type="button" variant="ghost" disabled={busy} onClick={goBackToEdit}>
                  {repairEditorCopy.backToEdit}
                </Button>
                <Button
                  type="button"
                  variant="solid"
                  disabled={busy}
                  onClick={() => void confirmCreate()}
                >
                  {busy ? repairEditorCopy.submitting : repairEditorCopy.confirmSubmit}
                </Button>
              </>
            )}
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="repair-editor">
      <AdminToast toast={toast} onDismiss={() => setToast(null)} />
      {rejection ? (
        <Card variant="notice">
          <strong>最新退回原因</strong>
          <p>{rejection.note}</p>
        </Card>
      ) : null}
      <Card className="repair-panel">
        {createMode ? (
          <div className="gap-s-1 grid">
            <h2 className="text-display-3 font-bold">{repairEditorCopy.createStepTitle}</h2>
            <p className="field__hint">{repairEditorCopy.createStepHint}</p>
          </div>
        ) : null}
        <form
          ref={formRef}
          tabIndex={-1}
          className="gap-s-5 grid"
          onSubmit={(e) => {
            e.preventDefault();
            // 新建流程没有「保存草稿」，回车不触发隐式保存，避免误以为已提交。
            if (allowSaveDraft) void save();
          }}
        >
          <div className="gap-s-4 grid items-start md:grid-cols-2">
            <label className="field">
              <span className="field__label">
                {repairEditorCopy.repairDateLabel}
                <span className="field__req">{repairEditorCopy.requiredMark}</span>
              </span>
              <input
                className="field__input"
                type="date"
                value={record.repairDate ?? ""}
                min={repairFieldLimits.repairDateMin}
                max={shanghaiToday()}
                onClick={openDatePicker}
                onChange={(e) => field("repairDate", e.target.value || null)}
              />
              <span className="field__hint">{repairEditorCopy.dateHint}</span>
            </label>
            <label className="field">
              <span className="field__label">
                {repairEditorCopy.ownerNameLabel}
                <span className="field__req">{repairEditorCopy.requiredMark}</span>
              </span>
              <input
                className="field__input"
                type="text"
                maxLength={repairFieldLimits.ownerNameMaxLength}
                value={record.ownerName ?? ""}
                onChange={(e) => field("ownerName", e.target.value || null)}
                aria-describedby="repair-owner-name-hint"
              />
              <span className="field__hint" id="repair-owner-name-hint">
                {repairEditorCopy.ownerNameHint}
              </span>
            </label>
            <label className="field">
              <span className="field__label">
                {repairEditorCopy.categoryLabel}
                <span className="field__req">{repairEditorCopy.requiredMark}</span>
              </span>
              <select
                className="field__input"
                value={record.category?.id ?? ""}
                onChange={(e) =>
                  field("category", categories.find((c) => c.id === e.target.value) ?? null)
                }
              >
                <option value="">请选择</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">
                {repairEditorCopy.deviceModelLabel}
                <span className="field__req">{repairEditorCopy.requiredMark}</span>
              </span>
              <input
                className="field__input"
                type="text"
                maxLength={repairFieldLimits.deviceModelMaxLength}
                placeholder={repairEditorCopy.deviceModelPlaceholder}
                value={record.deviceModel ?? ""}
                onChange={(e) => field("deviceModel", e.target.value || null)}
                aria-describedby="repair-device-model-hint"
              />
              <span className="field__hint" id="repair-device-model-hint">
                {repairEditorCopy.deviceModelHint}
                {returnActivityId ? ` ${repairEditorCopy.deviceModelActivityHint}` : null}
              </span>
            </label>
            <label className="field">
              <span className="field__label">
                {repairEditorCopy.durationLabel}
                <span className="field__req">{repairEditorCopy.requiredMark}</span>
              </span>
              <input
                className="field__input"
                type="number"
                inputMode="numeric"
                step={1}
                min={repairFieldLimits.durationMinutesMin}
                max={repairFieldLimits.durationMinutesMax}
                value={record.durationMinutes ?? ""}
                onChange={(e) =>
                  field(
                    "durationMinutes",
                    e.target.value === "" ? null : Number.parseInt(e.target.value, 10),
                  )
                }
                aria-describedby="repair-duration-hint"
              />
              <span className="field__hint" id="repair-duration-hint">
                {repairEditorCopy.durationHint}
              </span>
            </label>
            <label className="field">
              <span className="field__label">
                {repairEditorCopy.ownerPhoneLabel}
                <span className="field__req">{repairEditorCopy.requiredMark}</span>
              </span>
              <input
                className="field__input"
                type="tel"
                inputMode="numeric"
                maxLength={11}
                value={record.ownerPhone ?? ""}
                onChange={(e) => field("ownerPhone", e.target.value || null)}
                aria-describedby="repair-owner-phone-hint"
              />
              <span className="field__hint" id="repair-owner-phone-hint">
                {repairEditorCopy.ownerPhoneHint}
              </span>
            </label>
          </div>
          <RepairParticipantPicker
            creatorId={record.member.id}
            participants={record.participants}
            options={memberOptions}
            disabled={busy}
            scope={serveContext ? "attendance" : "all"}
            onAdd={addParticipant}
            onRemove={removeParticipant}
          />
          {allowSaveDraft ? <p className="field__hint">{repairEditorCopy.requiredNote}</p> : null}
          {serveContext ? <p className="field__hint">{repairEditorCopy.serveSubmitNote}</p> : null}
          <p className="field__hint">
            {(allowSaveDraft
              ? repairEditorCopy.resultDefaultHint
              : repairEditorCopy.resultDefaultHintSubmitOnly
            ).replace("{result}", repairResultLabels[defaultRepairResult])}
          </p>
          {createMode ? null : (
            <>
              <div className="signup__actions">
                {allowSaveDraft ? (
                  <Button type="submit" disabled={busy}>
                    保存草稿
                  </Button>
                ) : null}
                {serveContext ? (
                  <Button type="button" disabled={busy} onClick={saveAndReturn}>
                    {repairEditorCopy.serveStageAndBack}
                  </Button>
                ) : null}
                <Button type="button" variant="solid" disabled={busy} onClick={() => void submit()}>
                  提交审核
                </Button>
              </div>
              {message ? (
                <p className="signup__status" role="status">
                  {message}
                </p>
              ) : null}
            </>
          )}
        </form>
      </Card>
      <Card className="repair-panel">
        <div>
          <h2 className="text-display-3 font-bold">{repairEditorCopy.attachmentsTitle}</h2>
        </div>
        <label className="field">
          <span className="field__label">{repairEditorCopy.remarkLabel}</span>
          <textarea
            className="field__input min-h-40"
            maxLength={repairFieldLimits.remarkMaxLength}
            value={record.remark ?? ""}
            onChange={(e) => field("remark", e.target.value || null)}
            aria-describedby="repair-remark-hint"
          />
          <span className="field__hint" id="repair-remark-hint">
            {repairEditorCopy.remarkHint}
          </span>
        </label>
        {createMode ? (
          <>
            <PendingPhotoPicker
              photos={pendingPhotos}
              hint={`${createPhotoHint}。${repairEditorCopy.photoPendingNote}`}
              disabled={busy}
              emptyLabel={repairEditorCopy.noPhotos}
              onAdd={addPendingPhotos}
              onRemove={removePendingPhoto}
            />
            {message ? (
              <p className="signup__status signup__status--alert" role="alert">
                {message}
              </p>
            ) : null}
            <div className="signup__actions">
              {serveContext ? (
                <Button type="button" disabled={busy} onClick={saveAndReturn}>
                  {repairEditorCopy.serveStageAndBack}
                </Button>
              ) : null}
              <Button type="button" variant="solid" disabled={busy} onClick={goToConfirm}>
                {repairEditorCopy.nextStep}
              </Button>
            </div>
          </>
        ) : (
          <>
            <label className="field">
              <span className="field__label">{repairEditorCopy.photoSelectLabel}</span>
              <input
                className="field__input"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                disabled={busy}
                onChange={(e) => {
                  // 先拷成数组再清空 input：Blink 的 FileList 是活视图，清空 value 会把它一起清空，
                  // 存引用再清空等于传了个空列表；拷成数组后「同一张图片再选一次」也能触发 change。
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = "";
                  void upload(files);
                }}
              />
              <span className="field__hint">{photoHint}</span>
            </label>
            <div className="gap-s-4 grid md:grid-cols-2">
              {record.photos.map((photo, index) => (
                <figure className="gap-s-2 grid" key={photo.id}>
                  <Image
                    className="rounded-mid border-line h-56 w-full border object-cover"
                    src={photo.contentUrl}
                    alt={`维修照片 ${index + 1}`}
                    width={720}
                    height={480}
                    unoptimized
                  />
                  <figcaption className="gap-s-2 flex flex-wrap">
                    <Button
                      disabled={index === 0 || busy}
                      onClick={() => void reorder(photo.id, index - 1)}
                    >
                      前移
                    </Button>
                    <Button
                      disabled={index === record.photos.length - 1 || busy}
                      onClick={() => void reorder(photo.id, index + 1)}
                    >
                      后移
                    </Button>
                    <Button disabled={busy} onClick={() => void remove(photo.id)}>
                      移除
                    </Button>
                  </figcaption>
                </figure>
              ))}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
