"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import {
  formatShanghaiDateTime,
  formatShanghaiTimeRange,
  signupCountdownParts,
} from "@/components/repair-activities/activity-format";
import { AdminToast, type AdminToastMessage } from "@/components/admin/AdminToast";
import { repairActivityStatusBadgeClass } from "@/components/repair-activities/activity-status-badge";
import { RepairActivityPrecautions } from "@/components/repair-activities/RepairActivityPrecautions";
import { RepairActivityPreparation } from "@/components/repair-activities/RepairActivityPreparation";
import { RepairActivityQueue } from "@/components/repair-activities/RepairActivityQueue";
import { RepairActivityReceipt } from "@/components/repair-activities/RepairActivityReceipt";
import { fetchRegistrationDeviceStatus } from "@/features/repair-activities/registration-device-client";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { LoadFailure } from "@/components/ui/LoadFailure";
import { PageAlert } from "@/components/ui/PageAlert";
import { repairActivitiesPage } from "@/config/repair-activities";
import {
  activityEndBoundary,
  canAcceptNewRegistration,
  canShowPublicQueue,
  REPAIR_ACTIVITY_DEVICE_MODEL_MAX_LENGTH,
  repairActivityIssueTypeLabels,
  repairActivityRegistrationStatusLabels,
  repairActivityStatusLabels,
  type RepairActivityIssueType,
  type RepairActivityStatus,
} from "@/features/repair-activities/repair-activity-validation";
import type {
  RegistrationLookupView,
  RegistrationPublicView,
  RepairActivityPublicView,
} from "@/features/repair-activities/repair-activity-service";
import { CN_MOBILE_PATTERN } from "@/lib/security/normalization";

import styles from "./RepairActivityDetail.module.css";

/** 报名请求超过该时长仍未返回时，按「结果待确认」先查询，不直接判失败。 */
const SIGNUP_REQUEST_TIMEOUT_MS = 15_000;
/** 自动查询同样限时：查询也失败时停在待确认，避免界面无限等待。 */
const LOOKUP_REQUEST_TIMEOUT_MS = 10_000;

type LookupOutcome =
  | { kind: "found"; data: RegistrationLookupView }
  | { kind: "not-found"; message?: string }
  | { kind: "unknown"; message?: string };

type SignupField = "name" | "phone" | "issueType" | "deviceModel";

type SignupStep = 1 | 2 | 3;

/** 提交被拒绝后的终态；结果不占步骤条。 */
type SignupOutcome = "duplicate" | "full" | "failed" | "device";

type SignupDraft = {
  name: string;
  phone: string;
  issueType: string;
  deviceModel: string;
};

type SignupSubmission = SignupDraft;

type Props = { activityId: string };

/** 浏览器 setTimeout 的最大安全延时；超出会溢出并提前触发。 */
const MAX_TIMER_DELAY_MS = 2_147_483_647;

const SIGNUP_DRAFT_STORAGE_PREFIX = "zafu-pchospital:repair-activity-signup-draft:";
const EMPTY_SIGNUP_DRAFT: SignupDraft = {
  name: "",
  phone: "",
  issueType: "CLEAN_PASTE",
  deviceModel: "",
};

function readSignupDraft(activityId: string): SignupDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(SIGNUP_DRAFT_STORAGE_PREFIX + activityId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SignupDraft> | null;
    if (!parsed || typeof parsed !== "object") return null;
    const issueType =
      typeof parsed.issueType === "string" &&
      repairActivitiesPage.issueTypes.some((option) => option.value === parsed.issueType)
        ? parsed.issueType
        : EMPTY_SIGNUP_DRAFT.issueType;
    return {
      name: typeof parsed.name === "string" ? parsed.name.slice(0, 40) : "",
      phone: typeof parsed.phone === "string" ? parsed.phone.slice(0, 11) : "",
      issueType,
      deviceModel:
        typeof parsed.deviceModel === "string"
          ? parsed.deviceModel.slice(0, REPAIR_ACTIVITY_DEVICE_MODEL_MAX_LENGTH)
          : "",
    };
  } catch {
    return null;
  }
}

function writeSignupDraft(activityId: string, draft: SignupDraft) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(SIGNUP_DRAFT_STORAGE_PREFIX + activityId, JSON.stringify(draft));
  } catch {
    // 隐私模式或存储配额不足时放弃草稿，不阻断报名。
  }
}

function clearSignupDraft(activityId: string) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(SIGNUP_DRAFT_STORAGE_PREFIX + activityId);
  } catch {
    // 与 writeSignupDraft 相同：草稿只是便利功能。
  }
}

export function RepairActivityDetail({ activityId }: Props) {
  const copy = repairActivitiesPage.detail;
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [activity, setActivity] = useState<RepairActivityPublicView | null>(null);
  /** 服务器时间与本机时间之差：倒计时以服务器为准，避免本机时钟偏差。 */
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [problem, setProblem] = useState("");
  const [signupProblem, setSignupProblem] = useState("");
  const [notice, setNotice] = useState<AdminToastMessage | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<SignupStep>(1);
  const [consentChecked, setConsentChecked] = useState(false);
  const [consentError, setConsentError] = useState("");
  const [signupOutcome, setSignupOutcome] = useState<SignupOutcome | null>(null);
  const [signupDraft, setSignupDraft] = useState<SignupDraft>(EMPTY_SIGNUP_DRAFT);
  const [registrationResult, setRegistrationResult] = useState<RegistrationPublicView | null>(null);
  const [registeredPhone, setRegisteredPhone] = useState("");
  const [signupPending, setSignupPending] = useState<{ name: string; phone: string } | null>(null);
  /** 待确认查询的结论：未找到时提供重新填写，查询失败时只引导重试。 */
  const [pendingCheckResult, setPendingCheckResult] = useState<"not-found" | "unknown" | null>(
    null,
  );
  const [signupNameError, setSignupNameError] = useState("");
  const [signupPhoneError, setSignupPhoneError] = useState("");
  const [signupIssueTypeError, setSignupIssueTypeError] = useState("");
  const [signupDeviceModelError, setSignupDeviceModelError] = useState("");
  const [signupFocusField, setSignupFocusField] = useState<SignupField | null>(null);
  const [lookup, setLookup] = useState<RegistrationLookupView | null>(null);
  const [lookupPhone, setLookupPhone] = useState("");
  const [lookupPhoneError, setLookupPhoneError] = useState("");
  const [lookupNameError, setLookupNameError] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  /** 活动开始后不再展示自助取消；服务端仍会按同一时刻兜底。 */
  const [cancelWindowOpen, setCancelWindowOpen] = useState(true);
  /** 本设备已提交的报名（服务端签名 cookie）：有值时收起报名表单，只留查询入口。 */
  const [deviceRegistration, setDeviceRegistration] = useState<RegistrationPublicView | null>(null);
  /** 设备状态是否已有结论：未 resolve 前不渲染报名表单，避免「先在表单里输入、随后被收起」。 */
  const [deviceStatusResolved, setDeviceStatusResolved] = useState(false);
  const [deviceRechecking, setDeviceRechecking] = useState(false);
  const signupFormRef = useRef<HTMLFormElement>(null);
  const signupNameInputRef = useRef<HTMLInputElement>(null);
  const signupPhoneInputRef = useRef<HTMLInputElement>(null);
  const consentInputRef = useRef<HTMLInputElement>(null);
  const stepConfirmHeadingRef = useRef<HTMLHeadingElement>(null);
  const stepNoticeHeadingRef = useRef<HTMLHeadingElement>(null);
  const stepFormHeadingRef = useRef<HTMLHeadingElement>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  /** 草稿恢复完成前不要把初始空值写回存储，避免覆盖刷新前的输入。 */
  const draftHydratedRef = useRef(false);
  const lookupPhoneInputRef = useRef<HTMLInputElement>(null);
  const lookupNameInputRef = useRef<HTMLInputElement>(null);
  /** 换活动后丢弃旧的设备状态响应（含「重新检查」）。 */
  const deviceAttemptRef = useRef(0);
  /** 防止连点在 busy 重新渲染前发出第二个 POST。 */
  const submittingRef = useRef(false);
  /** 取消确认按钮同帧连点保护：cancelBusy 要等下一轮渲染才生效。 */
  const cancelSubmittingRef = useRef(false);
  /** 换活动后丢弃旧报名的迟到响应。 */
  const signupAttemptRef = useRef(0);
  /** 换活动后丢弃旧查询的迟到响应，并中止在途请求。 */
  const lookupAttemptRef = useRef(0);
  const lookupAbortRef = useRef<AbortController | null>(null);
  const request = useRef<{ background: boolean; controller: AbortController } | null>(null);

  // 字段错误在 busy 结束、免责声明弹层卸载后再聚焦；否则控件仍 disabled。
  useEffect(() => {
    if (busy || !signupFocusField || typeof window === "undefined") return;
    const field = signupFocusField;
    const focus = () => {
      if (field === "name") {
        signupNameInputRef.current?.focus();
      } else if (field === "phone") {
        signupPhoneInputRef.current?.focus();
      } else {
        const selector = {
          issueType: 'select[name="issueType"]',
          deviceModel: 'input[name="deviceModel"]',
        }[field];
        const element = signupFormRef.current?.querySelector?.(selector);
        if (element && "focus" in element) (element as HTMLElement).focus();
      }
      setSignupFocusField(null);
    };
    const usesRaf = typeof window.requestAnimationFrame === "function";
    const frame = usesRaf ? window.requestAnimationFrame(focus) : window.setTimeout(focus, 0);
    return () => {
      if (usesRaf) window.cancelAnimationFrame?.(frame);
      else window.clearTimeout(frame);
    };
  }, [busy, signupFocusField]);

  /**
   * `background` = 倒计时驱动的自动重取：传输 / 服务端瞬时失败时保留已渲染内容，
   * 不把整块切成错误态；活动确实结束（ENDED / 404）仍照常切换。
   */
  const load = useCallback(
    async (background = false) => {
      if (background && (document.visibilityState !== "visible" || request.current)) return;
      // 写入后的刷新可替换旧轮询，旧结果不能覆盖报名成功后的状态。
      request.current?.controller.abort();
      const active = { background, controller: new AbortController() };
      request.current = active;
      if (!background) setProblem("");
      try {
        const response = await fetch(`/api/v1/repair-activities/${activityId}`, {
          signal: active.controller.signal,
        });
        // HTTP Date 头就是服务器此刻的时间（秒级）：用它校正倒计时基准。
        const serverDate = Date.parse(response.headers.get("Date") ?? "");
        const json = (await response.json()) as {
          success: boolean;
          data?: RepairActivityPublicView;
          error?: { code?: string; message?: string };
        };
        if (request.current !== active) return;
        if (background && document.visibilityState !== "visible") return;
        if (Number.isFinite(serverDate)) setServerOffsetMs(serverDate - Date.now());
        if (!json.success || !json.data) {
          const ended = json.error?.code === "ACTIVITY_ENDED" || response.status === 404;
          if (background && !ended) return;
          if (ended) {
            setState("missing");
            setProblem(json.error?.message ?? "活动已结束");
            return;
          }
          setState("error");
          setProblem(json.error?.message ?? "加载失败");
          return;
        }
        setActivity(json.data);
        setState("ready");
      } catch {
        if (request.current !== active) return;
        if (background) return;
        setState("error");
        setProblem("加载失败，请稍后重试");
      } finally {
        if (request.current === active) request.current = null;
      }
    },
    [activityId],
  );

  useEffect(() => {
    signupAttemptRef.current += 1;
    lookupAttemptRef.current += 1;
    lookupAbortRef.current?.abort();
    lookupAbortRef.current = null;
    submittingRef.current = false;
    cancelSubmittingRef.current = false;
    setState("loading");
    setActivity(null);
    setStep(1);
    setConsentChecked(false);
    setConsentError("");
    setSignupOutcome(null);
    setSignupDraft(EMPTY_SIGNUP_DRAFT);
    setRegistrationResult(null);
    setRegisteredPhone("");
    setSignupPending(null);
    setPendingCheckResult(null);
    setSignupNameError("");
    setSignupPhoneError("");
    setSignupIssueTypeError("");
    setSignupDeviceModelError("");
    setSignupFocusField(null);
    setLookup(null);
    setLookupPhone("");
    setLookupPhoneError("");
    setLookupNameError("");
    setCancelOpen(false);
    setCancelBusy(false);
    setCancelWindowOpen(true);
    setDeviceRegistration(null);
    setDeviceStatusResolved(false);
    setDeviceRechecking(false);
    // 让在途的设备状态 / 重查请求作废，迟到响应不能写到新活动上。
    deviceAttemptRef.current += 1;
    setBusy(false);
    setProblem("");
    setSignupProblem("");
    setNotice(null);
    void load();
    return () => {
      lookupAbortRef.current?.abort();
      lookupAbortRef.current = null;
      const active = request.current;
      request.current = null;
      active?.controller.abort();
    };
  }, [load]);

  /** 刷新后恢复本活动的表单草稿；失败静默降级为空白表单。 */
  useEffect(() => {
    draftHydratedRef.current = false;
    setSignupDraft(readSignupDraft(activityId) ?? EMPTY_SIGNUP_DRAFT);
    draftHydratedRef.current = true;
  }, [activityId]);

  /**
   * 本设备是否已提交过本场报名（issue #304）。
   * 结论出来之前只显示占位、不渲染报名表单 —— 否则慢网下用户可能已开始填写，
   * 状态返回后表单被收起、焦点丢失。查询有 8 秒超时，超时 / 失败一律放开表单
   * （真正的重复拦截在服务端），不能因为设备接口卡住让报名入口永远不出现。
   */
  useEffect(() => {
    const attempt = ++deviceAttemptRef.current;
    const controller = new AbortController();
    void (async () => {
      let registration: RegistrationPublicView | null | undefined;
      try {
        registration = await fetchRegistrationDeviceStatus(activityId, {
          signal: controller.signal,
        });
      } catch {
        // helper 已内部兜底；这里再兜一层，任何意外都不能让「正在确认…」常驻。
        registration = undefined;
      } finally {
        if (deviceAttemptRef.current === attempt) {
          if (registration !== undefined) {
            setDeviceRegistration(registration);
            if (registration) {
              // 表单已收起，清掉可能残留的草稿，避免个人信息继续留在存储里。
              clearSignupDraft(activityId);
              setSignupDraft(EMPTY_SIGNUP_DRAFT);
              setStep(1);
              setConsentChecked(false);
              setSignupOutcome(null);
              setSignupProblem("");
            }
          }
          setDeviceStatusResolved(true);
        }
      }
    })();
    return () => controller.abort();
  }, [activityId]);

  /** 管理员删除报名后可就地重查，不必刷新整页；切活动时丢弃迟到响应。 */
  async function recheckDeviceStatus() {
    if (deviceRechecking) return;
    const attempt = deviceAttemptRef.current;
    setDeviceRechecking(true);
    try {
      const registration = await fetchRegistrationDeviceStatus(activityId);
      if (deviceAttemptRef.current !== attempt) return;
      setDeviceStatusResolved(true);
      if (registration === undefined) {
        setNotice({ text: copy.deviceRecheckFailed, tone: "neutral" });
      } else {
        setDeviceRegistration(registration);
        if (registration === null) {
          setNotice({ text: copy.deviceRecheckCleared, tone: "success" });
          // 报名入口重新出现，焦点回到第一步标题。
          focusSignupHeading(stepConfirmHeadingRef.current);
        } else {
          clearSignupDraft(activityId);
          setSignupDraft(EMPTY_SIGNUP_DRAFT);
          setStep(1);
          setConsentChecked(false);
          setSignupOutcome(null);
          setSignupProblem("");
        }
      }
    } catch {
      if (deviceAttemptRef.current === attempt) {
        setNotice({ text: copy.deviceRecheckFailed, tone: "neutral" });
      }
    } finally {
      // 无论成功、失败还是切活动，按钮都不能永久停在禁用态。
      if (deviceAttemptRef.current === attempt) setDeviceRechecking(false);
    }
  }

  /** 自助取消截止到活动开始；页面长开时也要在开始后收起按钮。 */
  useEffect(() => {
    if (!activity) return;
    const deadline = Date.parse(activity.activityAt);
    if (!Number.isFinite(deadline)) return;
    const update = () => setCancelWindowOpen(Date.now() + serverOffsetMs < deadline);
    update();
    const timer = window.setInterval(update, 30_000);
    return () => window.clearInterval(timer);
  }, [activity, serverOffsetMs]);

  /** 报名未开始时每秒走一格倒计时；状态一旦离开 UPCOMING 就停表。 */
  useEffect(() => {
    if (activity?.status !== "UPCOMING") return;
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activity?.status]);

  const signupOpensAtMs = activity ? Date.parse(activity.signupOpensAt) : Number.NaN;
  const countdownMs = Number.isFinite(signupOpensAtMs)
    ? signupOpensAtMs - (nowMs + serverOffsetMs)
    : Number.POSITIVE_INFINITY;
  const waitingForOpen = activity?.status === "UPCOMING" && countdownMs <= 0;
  const queueVisible =
    activity !== null && canShowPublicQueue(activity, new Date(nowMs + serverOffsetMs));

  /**
   * 倒计时归零：立刻重取活动状态（服务端按自己的时钟判定 OPEN / FULL / CLOSED）。
   * 仍显示未开始就每 30 秒重试，满足「无需手动刷新」—— 可能是本机与服务器时钟略有偏差。
   */
  useEffect(() => {
    if (!waitingForOpen) return;
    const refresh = () => void load(true);
    const visibility = () => {
      if (document.visibilityState === "visible") refresh();
      else if (request.current?.background) {
        const active = request.current;
        request.current = null;
        active.controller.abort();
      }
    };
    refresh();
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [waitingForOpen, load]);

  /** 排队区块只在活动开始到活动结束之间出现；在边界时刻刷新可见性。 */
  useEffect(() => {
    if (!activity) return;
    const startMs = Date.parse(activity.activityAt);
    const endMs = activityEndBoundary(new Date(activity.activityAt), activity.endsAt).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return;
    let cancelled = false;
    const timers: number[] = [];
    const schedule = (boundary: number) => {
      const delay = boundary - (Date.now() + serverOffsetMs);
      if (cancelled || delay <= 0) return;
      const wait = Math.min(delay + 100, MAX_TIMER_DELAY_MS);
      timers.push(
        window.setTimeout(() => {
          if (cancelled) return;
          setNowMs(Date.now());
          schedule(boundary);
        }, wait),
      );
    };
    schedule(startMs);
    schedule(endMs);
    return () => {
      cancelled = true;
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [activity, serverOffsetMs]);

  /** 倒计时归零转为可报名时，给读屏一次性播报（数字块本身不进入 live region）。 */
  const prevStatusRef = useRef<RepairActivityStatus | null>(null);
  const [openedNotice, setOpenedNotice] = useState(false);
  useEffect(() => {
    const current = activity?.status ?? null;
    if (
      prevStatusRef.current === "UPCOMING" &&
      current !== null &&
      current !== "UPCOMING" &&
      canAcceptNewRegistration(current)
    ) {
      setOpenedNotice(true);
    }
    prevStatusRef.current = current;
  }, [activity?.status]);

  /** 活动一旦离开报名中，已推进的步骤要退回第一步并重新给出锁定原因。 */
  useEffect(() => {
    if (!activity) return;
    if (!canAcceptNewRegistration(activity.status) && step > 1) {
      setStep(1);
      setConsentError("");
    }
  }, [activity, step]);

  function focusSignupHeading(element: HTMLElement | null) {
    window.setTimeout(() => element?.focus({ preventScroll: true }), 0);
  }

  function focusResult() {
    focusSignupHeading(resultHeadingRef.current);
  }

  function updateSignupDraft(patch: Partial<SignupDraft>) {
    setSignupDraft((previous) => {
      const next = { ...previous, ...patch };
      if (draftHydratedRef.current) writeSignupDraft(activityId, next);
      return next;
    });
  }

  function startSignup() {
    if (!activity || !canAcceptNewRegistration(activity.status)) return;
    setProblem("");
    setSignupProblem("");
    setNotice(null);
    setConsentError("");
    setStep(2);
    focusSignupHeading(stepNoticeHeadingRef.current);
  }

  function goToStep(next: 1 | 2) {
    if (next === 2 && (!activity || !canAcceptNewRegistration(activity.status))) return;
    setConsentError("");
    setStep(next);
    focusSignupHeading(next === 1 ? stepConfirmHeadingRef.current : stepNoticeHeadingRef.current);
  }

  function continueToForm() {
    if (!consentChecked) {
      setConsentError(copy.consent.required);
      consentInputRef.current?.focus();
      return;
    }
    setConsentError("");
    setStep(3);
    focusSignupHeading(stepFormHeadingRef.current);
  }

  /** 失败结果保留已填内容，返回第三步即可修改后重试。 */
  function backToForm() {
    setSignupOutcome(null);
    setSignupProblem("");
    setStep(3);
    focusSignupHeading(stepFormHeadingRef.current);
  }

  function resetSignupDraft() {
    setSignupDraft(EMPTY_SIGNUP_DRAFT);
    clearSignupDraft(activityId);
    setSignupNameError("");
    setSignupPhoneError("");
    setSignupIssueTypeError("");
    setSignupDeviceModelError("");
  }

  /** 第三步提交：同意已在第二步勾选并保留，这里不再弹二次确认。 */
  function requestSignup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || submittingRef.current || signupPending || signupOutcome) return;
    if (!activity || !canAcceptNewRegistration(activity.status)) return;
    setProblem("");
    setSignupProblem("");
    setNotice(null);
    setSignupNameError("");
    setSignupPhoneError("");
    setSignupIssueTypeError("");
    setSignupDeviceModelError("");
    setSignupFocusField(null);
    if (!consentChecked) {
      setStep(2);
      setConsentError(copy.consent.required);
      focusSignupHeading(stepNoticeHeadingRef.current);
      return;
    }
    const name = signupDraft.name.trim();
    if (name.length < 2) {
      setSignupNameError(copy.nameFormatHint);
      signupNameInputRef.current?.focus();
      return;
    }
    const phone = signupDraft.phone.trim();
    if (!CN_MOBILE_PATTERN.test(phone)) {
      setSignupPhoneError(copy.phoneFormatHint);
      signupPhoneInputRef.current?.focus();
      return;
    }
    void submitRegistration({
      name,
      phone,
      issueType: signupDraft.issueType,
      deviceModel: signupDraft.deviceModel.trim(),
    });
  }

  async function lookupRegistration(name: string, phone: string): Promise<LookupOutcome> {
    lookupAbortRef.current?.abort();
    const controller = new AbortController();
    lookupAbortRef.current = controller;
    try {
      const response = await fetch(`/api/v1/repair-activities/${activityId}/registrations/lookup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone }),
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(LOOKUP_REQUEST_TIMEOUT_MS),
        ]),
      });
      let json: {
        success: boolean;
        data?: RegistrationLookupView;
        error?: { message?: string };
      };
      try {
        json = (await response.json()) as typeof json;
      } catch {
        return { kind: "unknown" };
      }
      if (response.status === 404) {
        return { kind: "not-found", message: json.error?.message };
      }
      if (!json.success || !json.data) {
        return { kind: "unknown", message: json.error?.message };
      }
      return { kind: "found", data: json.data };
    } catch {
      return { kind: "unknown" };
    } finally {
      if (lookupAbortRef.current === controller) lookupAbortRef.current = null;
    }
  }

  /** POST 可能已落库但响应丢失：先查询确认，无法确认时停在“待确认”。 */
  async function handleUncertainSignup(pending: SignupSubmission, attempt: number) {
    const outcome = await lookupRegistration(pending.name, pending.phone);
    if (signupAttemptRef.current !== attempt) return;
    if (outcome.kind === "found") {
      setRegistrationResult(outcome.data);
      setDeviceRegistration(outcome.data);
      setRegisteredPhone(pending.phone);
      setSignupPending(null);
      setPendingCheckResult(null);
      setSignupOutcome(null);
      setNotice({ text: copy.lookupConfirmed, tone: "success" });
      resetSignupDraft();
      setStep(1);
      focusResult();
      void load(true);
      return;
    }
    setSignupPending({ name: pending.name, phone: pending.phone });
    setPendingCheckResult(outcome.kind === "not-found" ? "not-found" : "unknown");
    focusResult();
  }

  /** 第三步直接提交；同意与字段都已在前面确认过。 */
  async function submitRegistration(pending: SignupSubmission) {
    if (submittingRef.current) return;
    const attempt = ++signupAttemptRef.current;
    submittingRef.current = true;
    setBusy(true);
    setProblem("");
    setSignupProblem("");
    setNotice(null);
    try {
      let response: Response;
      try {
        response = await fetch(`/api/v1/repair-activities/${activityId}/registrations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...pending, consentAccepted: true }),
          signal: AbortSignal.timeout(SIGNUP_REQUEST_TIMEOUT_MS),
        });
      } catch {
        if (signupAttemptRef.current === attempt) {
          await handleUncertainSignup(pending, attempt);
        }
        return;
      }
      let json: {
        success: boolean;
        data?: RegistrationPublicView;
        error?: { code?: string; message?: string; fieldErrors?: Record<string, string[]> };
      };
      try {
        json = (await response.json()) as typeof json;
      } catch {
        if (signupAttemptRef.current === attempt) {
          await handleUncertainSignup(pending, attempt);
        }
        return;
      }
      if (signupAttemptRef.current !== attempt) return;
      if (response.status >= 500) {
        await handleUncertainSignup(pending, attempt);
        return;
      }
      if (!json.success) {
        setRegisteredPhone(pending.phone);
        const fieldErrors = json.error?.fieldErrors;
        const fieldMessages = {
          name: fieldErrors?.name?.[0] ?? "",
          phone: fieldErrors?.phone?.[0] ?? "",
          issueType: fieldErrors?.issueType?.[0] ?? "",
          deviceModel: fieldErrors?.deviceModel?.[0] ?? "",
        };
        const firstField = (["name", "phone", "issueType", "deviceModel"] as const).find(
          (field) => fieldMessages[field],
        );
        if (firstField) {
          setSignupNameError(fieldMessages.name);
          setSignupPhoneError(fieldMessages.phone);
          setSignupIssueTypeError(fieldMessages.issueType);
          setSignupDeviceModelError(fieldMessages.deviceModel);
          setSignupFocusField(firstField);
          return;
        }
        if (json.error?.code === "ACTIVITY_DEVICE_ALREADY_REGISTERED") {
          // 另一个 tab 已报过 / 本地状态没跟上：直接切到「已提交」结果，而不是只报一条错误。
          let registration: RegistrationPublicView | null | undefined;
          try {
            registration = await fetchRegistrationDeviceStatus(activityId);
          } catch {
            registration = undefined;
          }
          if (signupAttemptRef.current !== attempt) return;
          if (registration) {
            setDeviceRegistration(registration);
            clearSignupDraft(activityId);
            setSignupDraft(EMPTY_SIGNUP_DRAFT);
            setStep(1);
            setConsentChecked(false);
            setSignupOutcome(null);
            setNotice({ text: copy.deviceRegisteredTitle, tone: "neutral" });
            focusLookup(undefined, registration.name);
          } else {
            // 设备 409 与「当前手机号重复」无关，不能用 duplicateHint 的文案。
            setSignupOutcome("device");
            setSignupProblem(json.error?.message ?? copy.deviceConflictFallback);
            focusResult();
          }
        } else if (json.error?.code === "ACTIVITY_REGISTRATION_DUPLICATE") {
          setSignupOutcome("duplicate");
          focusResult();
        } else if (json.error?.code === "ACTIVITY_FULL") {
          setSignupOutcome("full");
          focusResult();
          void load(true);
        } else {
          setSignupOutcome("failed");
          setSignupProblem(json.error?.message ?? copy.signupFailed);
          focusResult();
        }
      } else {
        setRegistrationResult(json.data ?? null);
        setDeviceRegistration(json.data ?? null);
        setRegisteredPhone(pending.phone);
        setSignupProblem("");
        setSignupPending(null);
        setPendingCheckResult(null);
        setSignupOutcome(null);
        resetSignupDraft();
        setStep(1);
        setConsentChecked(false);
        focusResult();
        // 刷新独立收尾，不延长 POST 的忙碌周期，也不解除下一次操作的禁用。
        // 报名已成功：刷新失败时保留当前页面与成功提醒。
        void load(true);
      }
    } finally {
      if (signupAttemptRef.current === attempt) {
        submittingRef.current = false;
        setBusy(false);
      }
    }
  }

  async function checkPendingSignup() {
    if (!signupPending || busy) return;
    const pending = signupPending;
    const attempt = ++lookupAttemptRef.current;
    setBusy(true);
    const outcome = await lookupRegistration(pending.name, pending.phone);
    if (lookupAttemptRef.current !== attempt) return;
    if (outcome.kind === "found") {
      setSignupPending(null);
      setPendingCheckResult(null);
      setRegistrationResult(outcome.data);
      setDeviceRegistration(outcome.data);
      setRegisteredPhone(pending.phone);
      setNotice({ text: copy.lookupConfirmed, tone: "success" });
      resetSignupDraft();
      setStep(1);
      focusResult();
      void load(true);
    } else {
      setPendingCheckResult(outcome.kind === "not-found" ? "not-found" : "unknown");
    }
    setBusy(false);
  }

  /** 查询确认未报名后，解除待确认并允许重新填写；重复提交仍由服务端判重兜底。 */
  function restartPendingSignup() {
    setSignupPending(null);
    setPendingCheckResult(null);
    setSignupOutcome(null);
    setSignupProblem("");
    resetSignupDraft();
    setStep(3);
    focusSignupHeading(stepFormHeadingRef.current);
  }

  function focusLookup(phone?: string, name?: string) {
    const input = lookupPhoneInputRef.current;
    if (phone && input) input.value = phone;
    const nameInput = lookupNameInputRef.current;
    if (name && nameInput) nameInput.value = name;
    setLookupPhoneError("");
    setLookupNameError("");
    (name ? nameInput : input)?.scrollIntoView({ block: "center" });
    (name ? nameInput : input)?.focus({ preventScroll: true });
  }

  async function doLookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    const name = (data.name ?? "").trim();
    const phone = (data.phone ?? "").trim();
    if (name.length < 2) {
      setLookupNameError(copy.nameFormatHint);
      lookupNameInputRef.current?.focus();
      return;
    }
    if (!CN_MOBILE_PATTERN.test(phone)) {
      setLookupPhoneError(copy.phoneFormatHint);
      lookupPhoneInputRef.current?.focus();
      return;
    }
    const attempt = ++lookupAttemptRef.current;
    setBusy(true);
    setProblem("");
    setNotice(null);
    setLookup(null);
    setLookupPhone("");
    setLookupPhoneError("");
    setLookupNameError("");
    const outcome = await lookupRegistration(name, phone);
    if (lookupAttemptRef.current !== attempt) return;
    const matchesPending = signupPending?.phone === phone && signupPending.name.trim() === name;
    if (outcome.kind === "found") {
      setLookup(outcome.data);
      setLookupPhone(phone);
      setRegisteredPhone(phone);
      setNotice({ text: copy.lookupSuccess, tone: "success" });
      if (matchesPending) {
        setSignupPending(null);
        setPendingCheckResult(null);
        setSignupOutcome(null);
        setRegistrationResult(outcome.data);
        setDeviceRegistration(outcome.data);
        resetSignupDraft();
        setStep(1);
        focusResult();
        void load(true);
      }
    } else if (matchesPending) {
      setPendingCheckResult(outcome.kind === "not-found" ? "not-found" : "unknown");
    } else {
      setProblem(
        outcome.kind === "not-found"
          ? (outcome.message ?? copy.lookupNotFound)
          : (outcome.message ?? "网络异常，请稍后重试"),
      );
    }
    setBusy(false);
  }

  async function updateType(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!lookup) return;
    const attempt = ++lookupAttemptRef.current;
    setBusy(true);
    setProblem("");
    setNotice(null);
    const data = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    try {
      const response = await fetch(
        `/api/v1/repair-activities/${activityId}/registrations/${lookup.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            issueType: data.issueType ?? "",
            phone: lookupPhone,
            editToken: lookup.editToken,
          }),
          signal: AbortSignal.timeout(LOOKUP_REQUEST_TIMEOUT_MS),
        },
      );
      const json = (await response.json()) as {
        success: boolean;
        data?: RegistrationLookupView;
        error?: { message?: string; code?: string };
      };
      if (lookupAttemptRef.current !== attempt) return;
      if (!json.success) {
        setProblem(json.error?.message ?? "修改失败");
      } else {
        setNotice({ text: copy.updateSuccess, tone: "success" });
        if (json.data) {
          setLookup({ ...lookup, issueType: json.data.issueType, status: json.data.status });
        }
      }
    } catch {
      if (lookupAttemptRef.current === attempt) setProblem("网络异常，请稍后重试");
    } finally {
      if (lookupAttemptRef.current === attempt) setBusy(false);
    }
  }

  /** 活动开始前自助取消：软删报名、释放名额；成功后本设备可重新报名。 */
  async function cancelRegistration() {
    if (!lookup || cancelBusy || cancelSubmittingRef.current) return;
    cancelSubmittingRef.current = true;
    const target = lookup;
    const attempt = ++lookupAttemptRef.current;
    setCancelBusy(true);
    setProblem("");
    try {
      const response = await fetch(
        `/api/v1/repair-activities/${activityId}/registrations/${target.id}/cancel`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: target.name,
            phone: lookupPhone,
            editToken: target.editToken,
          }),
          signal: AbortSignal.timeout(LOOKUP_REQUEST_TIMEOUT_MS),
        },
      );
      const json = (await response.json()) as {
        success: boolean;
        error?: { message?: string };
      };
      if (lookupAttemptRef.current !== attempt) return;
      if (!json.success) {
        setCancelOpen(false);
        setProblem(json.error?.message ?? "取消失败，请稍后重试");
        void load(true);
        return;
      }
      setCancelOpen(false);
      setLookup(null);
      setLookupPhone("");
      setLookupPhoneError("");
      setLookupNameError("");
      // 让在途设备状态查询作废：迟到响应不能把刚取消的报名重新写回面板。
      deviceAttemptRef.current += 1;
      // 同一设备取消后立即解锁报名表单；其它设备上的报名状态不动。
      if (deviceRegistration?.id === target.id) setDeviceRegistration(null);
      setDeviceStatusResolved(true);
      resetSignupDraft();
      setSignupPending(null);
      setPendingCheckResult(null);
      setSignupOutcome(null);
      setSignupProblem("");
      setConsentChecked(false);
      setStep(1);
      setNotice({ text: copy.cancelSuccess, tone: "success" });
      void load(true);
      window.setTimeout(() => lookupNameInputRef.current?.focus({ preventScroll: true }), 0);
    } catch {
      if (lookupAttemptRef.current === attempt) {
        setCancelOpen(false);
        setProblem("网络异常，请稍后重试");
        void load(true);
      }
    } finally {
      cancelSubmittingRef.current = false;
      if (lookupAttemptRef.current === attempt) setCancelBusy(false);
    }
  }

  if (state === "loading") return <p className="muted">正在加载活动…</p>;
  if (state === "missing") {
    return (
      <Card className="repair-panel">
        <h1 className="admin-panel__title" id="repair-activity-detail-title">
          {copy.breadcrumb}
        </h1>
        <p className="muted" role="alert">
          {problem || "活动已结束"}
        </p>
        <div className="signup__actions">
          <Button variant="ghost" href="/repair-activities">
            返回活动列表
          </Button>
        </div>
      </Card>
    );
  }
  if (state === "error" || !activity) {
    return (
      <div className={styles.detail}>
        <h1 className="admin-panel__title" id="repair-activity-detail-title">
          {copy.breadcrumb}
        </h1>
        <LoadFailure
          message={problem}
          retryLabel={copy.reload}
          onRetry={() => load()}
          backHref="/repair-activities"
          backLabel={copy.backToList}
        />
      </div>
    );
  }

  const open = canAcceptNewRegistration(activity.status);
  const countdown = signupCountdownParts(countdownMs);
  const countdownOpens = copy.countdownOpensHint.replace(
    "{open}",
    formatShanghaiDateTime(activity.signupOpensAt),
  );
  const signupDisabledReason =
    activity.status === "UPCOMING"
      ? copy.upcomingDisabled
      : activity.status === "CLOSED"
        ? copy.closedDisabled
        : activity.status === "FULL"
          ? copy.fullDisabled
          : copy.signupDisabled;
  const activityTimeRange =
    formatShanghaiTimeRange(activity.activityAt, activity.endsAt) ??
    formatShanghaiDateTime(activity.activityAt);
  const signupWindow = `${formatShanghaiDateTime(activity.signupOpensAt)} — ${formatShanghaiDateTime(activity.signupClosesAt)}`;
  const signupTerminal =
    registrationResult !== null ||
    signupPending !== null ||
    deviceRegistration !== null ||
    signupOutcome !== null;
  const steps = [
    { index: 1 as const, label: copy.steps[0] },
    { index: 2 as const, label: copy.steps[1] },
    { index: 3 as const, label: copy.steps[2] },
  ];

  return (
    <div className={`activity-detail ${styles.detail}`}>
      <nav className={styles.breadcrumb} aria-label={copy.breadcrumb}>
        <Link href="/repair-activities">{copy.backToList}</Link>
        <span aria-hidden="true"> / </span>
        <span>{copy.breadcrumb}</span>
      </nav>
      <header className={styles.overview}>
        <p className={styles.category}>{copy.category}</p>
        <div className="activity-card__head">
          <h1 className={styles.title} id="repair-activity-detail-title">
            {activity.title}
          </h1>
          <span className={repairActivityStatusBadgeClass(activity.status)}>
            {repairActivityStatusLabels[activity.status as RepairActivityStatus]}
          </span>
        </div>
        <dl className={styles.meta}>
          <div>
            <dt>{repairActivitiesPage.activityAt}</dt>
            <dd>
              {formatShanghaiTimeRange(activity.activityAt, activity.endsAt) ??
                formatShanghaiDateTime(activity.activityAt)}
            </dd>
          </div>
          {activity.location ? (
            <div>
              <dt>{repairActivitiesPage.location}</dt>
              <dd>{activity.location}</dd>
            </div>
          ) : null}
          <div>
            <dt>{repairActivitiesPage.window}</dt>
            <dd>
              {formatShanghaiDateTime(activity.signupOpensAt)} —{" "}
              {formatShanghaiDateTime(activity.signupClosesAt)}
            </dd>
          </div>
          <div>
            <dt className="sr-only">名额</dt>
            <dd>
              {repairActivitiesPage.capacity
                .replace("{registered}", String(activity.registeredCount))
                .replace("{capacity}", String(activity.capacity))}
              {" · "}
              {repairActivitiesPage.remaining.replace("{count}", String(activity.remaining))}
            </dd>
          </div>
        </dl>
      </header>

      {queueVisible ? <RepairActivityQueue key={activity.id} activityId={activity.id} /> : null}

      <AdminToast toast={notice} onDismiss={() => setNotice(null)} />
      {problem ? (
        <PageAlert
          message={problem}
          closeLabel={copy.dismissError}
          onClose={() => setProblem("")}
        />
      ) : null}

      <div className={styles.layout}>
        <section aria-labelledby="repair-activity-precautions-title">
          <h2 className="admin-panel__title" id="repair-activity-precautions-title">
            {copy.precautionsTitle}
          </h2>
          <RepairActivityPreparation />
          <div className={styles.service}>
            <h3>{copy.serviceTitle}</h3>
            <p>{copy.serviceHint}</p>
          </div>
          <details className={styles.fullPrecautions}>
            <summary>
              {copy.fullPrecautions.replace("{count}", String(copy.consent.clauses.length))}
            </summary>
            <RepairActivityPrecautions />
          </details>
        </section>

        <div className={styles.actions}>
          <section
            className="activity-detail__signup"
            aria-labelledby="repair-activity-signup-title"
          >
            <h2
              className="admin-panel__title"
              id="repair-activity-signup-title"
              ref={resultHeadingRef}
              tabIndex={-1}
            >
              {signupTerminal ? copy.resultTitle : copy.signupTitle}
            </h2>

            {signupTerminal ? (
              <div className={styles.signupTerminal}>
                {registrationResult ? (
                  <>
                    <RepairActivityReceipt activity={activity} registration={registrationResult} />
                    <p className="muted">{copy.registeredHint}</p>
                    <div className={styles.resultActions}>
                      <Button
                        variant="ghost"
                        onClick={() => focusLookup(registeredPhone, registrationResult.name)}
                      >
                        {copy.lookupMine}
                      </Button>
                    </div>
                  </>
                ) : signupPending ? (
                  <div className={styles.resultPanel}>
                    <div className={styles.resultHead}>
                      <span
                        className={`${styles.resultMark} ${styles.resultMarkError}`}
                        aria-hidden="true"
                      >
                        !
                      </span>
                      <h3 className={styles.resultTitle}>{copy.signupPendingTitle}</h3>
                      <p className={styles.resultDesc}>{copy.signupPendingHint}</p>
                      {pendingCheckResult ? (
                        <p className={styles.resultDesc}>
                          {pendingCheckResult === "not-found"
                            ? copy.lookupNotFoundRetry
                            : copy.lookupFailedRetry}
                        </p>
                      ) : null}
                    </div>
                    <div className={styles.resultActions}>
                      <Button
                        variant="ghost"
                        onClick={() => void checkPendingSignup()}
                        disabled={busy}
                      >
                        {copy.checkResult}
                      </Button>
                      {pendingCheckResult === "not-found" ? (
                        <Button variant="ghost" onClick={restartPendingSignup} disabled={busy}>
                          {copy.pendingRestart}
                        </Button>
                      ) : null}
                    </div>
                    {pendingCheckResult === "not-found" ? (
                      <p className="muted">{copy.pendingRestartHint}</p>
                    ) : null}
                  </div>
                ) : deviceRegistration ? (
                  /* 本设备已提交：收起报名流程，只保留查询与重查出口（issue #304）。 */
                  <div className={styles.resultPanel}>
                    <div className={styles.resultHead}>
                      <span
                        className={`${styles.resultMark} ${styles.resultMarkError}`}
                        aria-hidden="true"
                      >
                        !
                      </span>
                      <h3 className={styles.resultTitle}>{copy.deviceRegisteredTitle}</h3>
                      <p className={styles.resultDesc}>
                        {deviceRegistration.name} · {deviceRegistration.phoneMasked}
                      </p>
                      <p className={styles.resultDesc}>
                        {copy.receiptIssueType.replace(
                          "{type}",
                          repairActivityIssueTypeLabels[
                            deviceRegistration.issueType as RepairActivityIssueType
                          ] ?? deviceRegistration.issueType,
                        )}
                      </p>
                      <p className={styles.resultDesc}>{copy.deviceRegisteredHint}</p>
                    </div>
                    <div className={styles.resultActions}>
                      <Button
                        variant="ghost"
                        onClick={() => focusLookup(undefined, deviceRegistration.name)}
                      >
                        {copy.lookupMine}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => void recheckDeviceStatus()}
                        disabled={deviceRechecking}
                      >
                        {copy.deviceRecheck}
                      </Button>
                    </div>
                    <p className="muted">{copy.deviceRecheckHint}</p>
                  </div>
                ) : signupOutcome ? (
                  <div className={styles.resultPanel}>
                    <div className={styles.resultHead}>
                      <span
                        className={`${styles.resultMark} ${
                          signupOutcome === "duplicate"
                            ? styles.resultMarkSuccess
                            : styles.resultMarkError
                        }`}
                        aria-hidden="true"
                      >
                        {signupOutcome === "duplicate" ? "✓" : "!"}
                      </span>
                      <h3 className={styles.resultTitle}>
                        {signupOutcome === "duplicate"
                          ? copy.duplicateTitle
                          : signupOutcome === "full"
                            ? copy.fullResultTitle
                            : signupOutcome === "device"
                              ? copy.deviceRegisteredTitle
                              : copy.signupFailedTitle}
                      </h3>
                      <p className={styles.resultDesc}>
                        {signupOutcome === "duplicate"
                          ? copy.duplicateHint
                          : signupOutcome === "full"
                            ? copy.fullResultHint
                            : signupProblem || copy.deviceConflictFallback}
                      </p>
                      {signupOutcome === "full" ? (
                        <p className={styles.resultDesc}>{copy.fullLookupHint}</p>
                      ) : null}
                    </div>
                    <div className={styles.resultActions}>
                      {signupOutcome === "failed" ? (
                        <Button variant="solid" onClick={backToForm}>
                          {copy.confirmEdit}
                        </Button>
                      ) : (
                        <>
                          <Button
                            variant="solid"
                            onClick={() =>
                              focusLookup(registeredPhone, signupDraft.name.trim() || undefined)
                            }
                          >
                            {copy.lookupMine}
                          </Button>
                          {signupOutcome === "device" ? (
                            <Button
                              variant="ghost"
                              onClick={() => void recheckDeviceStatus()}
                              disabled={deviceRechecking}
                            >
                              {copy.deviceRecheck}
                            </Button>
                          ) : null}
                        </>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : !deviceStatusResolved ? (
              <p className="muted" role="status">
                {copy.deviceStatusChecking}
              </p>
            ) : (
              <div className={styles.wizard}>
                {open ? (
                  <ol className={styles.stepper} aria-label={copy.stepLabel}>
                    {steps.map((item) => {
                      const mode =
                        item.index < step ? "done" : item.index === step ? "current" : "future";
                      const modeClass =
                        mode === "done"
                          ? styles.stepDone
                          : mode === "current"
                            ? styles.stepCurrent
                            : "";
                      const modeLabel =
                        mode === "done"
                          ? copy.stepDoneSuffix
                          : mode === "current"
                            ? copy.stepCurrentSuffix
                            : "";
                      return (
                        <li key={item.index} className={`${styles.step} ${modeClass}`}>
                          <button
                            type="button"
                            className={styles.stepButton}
                            aria-current={mode === "current" ? "step" : undefined}
                            aria-label={`${copy.stepIndex.replace(
                              "{index}",
                              String(item.index),
                            )}：${item.label}${modeLabel}`}
                            disabled={item.index >= step}
                            onClick={() => {
                              if (item.index === 1) goToStep(1);
                              else if (item.index === 2) goToStep(2);
                            }}
                          >
                            <span className={styles.stepDot} aria-hidden="true">
                              {mode === "done" ? "✓" : item.index}
                            </span>
                            <span className={styles.stepText}>
                              <span className={styles.stepIndex}>
                                {copy.stepIndex.replace("{index}", String(item.index))}
                              </span>
                              <span className={styles.stepLabel}>{item.label}</span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                ) : (
                  <p className={styles.flowLock}>{copy.flowLocked}</p>
                )}

                <section
                  className={styles.stepPanel}
                  hidden={step !== 1}
                  aria-labelledby="repair-activity-signup-step-1"
                >
                  <h3
                    className={styles.stepTitle}
                    id="repair-activity-signup-step-1"
                    ref={stepConfirmHeadingRef}
                    tabIndex={-1}
                  >
                    {copy.stepTitles[0]}
                  </h3>
                  <p className={styles.stepLead}>{copy.stepLeads[0]}</p>
                  <dl className={styles.summary}>
                    <div>
                      <dt>{repairActivitiesPage.activityAt}</dt>
                      <dd>{activityTimeRange}</dd>
                    </div>
                    {activity.location ? (
                      <div>
                        <dt>{repairActivitiesPage.location}</dt>
                        <dd>{activity.location}</dd>
                      </div>
                    ) : null}
                    <div>
                      <dt>{repairActivitiesPage.window}</dt>
                      <dd>{signupWindow}</dd>
                    </div>
                    <div>
                      <dt className="sr-only">名额</dt>
                      <dd>
                        {repairActivitiesPage.capacity
                          .replace("{registered}", String(activity.registeredCount))
                          .replace("{capacity}", String(activity.capacity))}
                        {" · "}
                        {repairActivitiesPage.remaining.replace(
                          "{count}",
                          String(activity.remaining),
                        )}
                      </dd>
                    </div>
                  </dl>
                  {/* 开始时间解析不出（契约保证不会）时整块不渲染，避免数字块出现 Infinity。 */}
                  {activity.status === "UPCOMING" && Number.isFinite(countdownMs) ? (
                    <div className="activity-countdown" role="timer">
                      <p className="activity-countdown__label">{copy.countdownPrefix}</p>
                      {waitingForOpen ? (
                        <p className="activity-countdown__opening">{copy.countdownOpeningSoon}</p>
                      ) : (
                        <>
                          <div className="activity-countdown__blocks">
                            {countdown.days > 0 ? (
                              <>
                                <span className="activity-countdown__block">
                                  <span className="activity-countdown__num">
                                    {String(countdown.days).padStart(2, "0")}
                                  </span>
                                  <span className="activity-countdown__unit">
                                    {copy.countdownUnits.days}
                                  </span>
                                </span>
                                <span className="activity-countdown__colon" aria-hidden="true">
                                  :
                                </span>
                              </>
                            ) : null}
                            <span className="activity-countdown__block">
                              <span className="activity-countdown__num">{countdown.hours}</span>
                              <span className="activity-countdown__unit">
                                {copy.countdownUnits.hours}
                              </span>
                            </span>
                            <span className="activity-countdown__colon" aria-hidden="true">
                              :
                            </span>
                            <span className="activity-countdown__block">
                              <span className="activity-countdown__num">{countdown.minutes}</span>
                              <span className="activity-countdown__unit">
                                {copy.countdownUnits.minutes}
                              </span>
                            </span>
                            <span className="activity-countdown__colon" aria-hidden="true">
                              :
                            </span>
                            <span className="activity-countdown__block">
                              <span className="activity-countdown__num">{countdown.seconds}</span>
                              <span className="activity-countdown__unit">
                                {copy.countdownUnits.seconds}
                              </span>
                            </span>
                          </div>
                          <p className="activity-countdown__hint">{countdownOpens}</p>
                        </>
                      )}
                    </div>
                  ) : null}
                  {activity.status === "FULL" ? (
                    <div className={styles.fullHint}>
                      <p className="muted">{copy.fullLookupHint}</p>
                      <Button variant="ghost" onClick={() => focusLookup()}>
                        {copy.lookupMine}
                      </Button>
                    </div>
                  ) : null}
                  <div className={styles.stepActions}>
                    <Button variant="solid" onClick={startSignup} disabled={!open}>
                      {open
                        ? consentChecked
                          ? copy.continueSignup
                          : copy.startSignup
                        : signupDisabledReason}
                    </Button>
                    <Button variant="ghost" onClick={() => focusLookup()}>
                      {copy.lookupEntry}
                    </Button>
                  </div>
                </section>

                <section
                  className={styles.stepPanel}
                  hidden={step !== 2}
                  aria-labelledby="repair-activity-signup-step-2"
                >
                  <h3
                    className={styles.stepTitle}
                    id="repair-activity-signup-step-2"
                    ref={stepNoticeHeadingRef}
                    tabIndex={-1}
                  >
                    {copy.stepTitles[1]}
                  </h3>
                  <p className={styles.stepLead}>{copy.consent.subtitle}</p>
                  <div className={styles.noticeBlock} tabIndex={0}>
                    <RepairActivityPrecautions />
                  </div>
                  <label className={styles.consentCheck}>
                    <input
                      ref={consentInputRef}
                      type="checkbox"
                      checked={consentChecked}
                      onChange={(event) => {
                        setConsentChecked(event.target.checked);
                        if (event.target.checked) setConsentError("");
                      }}
                      aria-invalid={consentError ? true : undefined}
                      aria-describedby={
                        consentError ? "repair-activity-signup-consent-error" : undefined
                      }
                    />
                    <span>{copy.consent.agree}</span>
                  </label>
                  {consentError ? (
                    <p
                      className="field__hint text-accent-deep"
                      id="repair-activity-signup-consent-error"
                      role="alert"
                    >
                      {consentError}
                    </p>
                  ) : null}
                  <div className={styles.stepActions}>
                    <Button variant="outline" onClick={() => goToStep(1)}>
                      {copy.previousStep}
                    </Button>
                    <Button variant="solid" onClick={continueToForm}>
                      {copy.nextStep}
                    </Button>
                  </div>
                </section>

                <section
                  className={styles.stepPanel}
                  hidden={step !== 3}
                  aria-labelledby="repair-activity-signup-step-3"
                >
                  <h3
                    className={styles.stepTitle}
                    id="repair-activity-signup-step-3"
                    ref={stepFormHeadingRef}
                    tabIndex={-1}
                  >
                    {copy.stepTitles[2]}
                  </h3>
                  <p className={styles.stepLead}>{copy.confirmIdentityHint}</p>
                  <p className={styles.stepActivity}>
                    {activity.title} · {activityTimeRange}
                  </p>
                  <form
                    className="admin-form"
                    ref={signupFormRef}
                    tabIndex={-1}
                    onSubmit={requestSignup}
                    aria-label={copy.signupTitle}
                  >
                    <div className={styles.fields}>
                      <label className="field">
                        <span className="field__label">
                          {copy.name} <span className={styles.required}>*</span>
                        </span>
                        <input
                          ref={signupNameInputRef}
                          className="field__input"
                          id="repair-activity-signup-name"
                          name="name"
                          placeholder={copy.namePlaceholder}
                          required
                          minLength={2}
                          maxLength={40}
                          value={signupDraft.name}
                          aria-invalid={signupNameError ? true : undefined}
                          aria-describedby={
                            signupNameError ? "repair-activity-signup-name-error" : undefined
                          }
                          onChange={(event) => {
                            updateSignupDraft({ name: event.target.value });
                            setSignupNameError("");
                          }}
                          disabled={!open || busy}
                        />
                        {signupNameError ? (
                          <p
                            className="field__hint text-accent-deep"
                            id="repair-activity-signup-name-error"
                            role="alert"
                          >
                            {signupNameError}
                          </p>
                        ) : null}
                      </label>
                      <label className="field">
                        <span className="field__label">
                          {copy.phone} <span className={styles.required}>*</span>
                        </span>
                        <input
                          ref={signupPhoneInputRef}
                          className="field__input"
                          id="repair-activity-signup-phone"
                          name="phone"
                          placeholder={copy.phonePlaceholder}
                          required
                          inputMode="numeric"
                          maxLength={11}
                          value={signupDraft.phone}
                          aria-invalid={signupPhoneError ? true : undefined}
                          aria-describedby={
                            signupPhoneError ? "repair-activity-signup-phone-error" : undefined
                          }
                          onChange={(event) => {
                            updateSignupDraft({ phone: event.target.value });
                            setSignupPhoneError("");
                          }}
                          disabled={!open || busy}
                        />
                        {signupPhoneError ? (
                          <p
                            className="field__hint text-accent-deep"
                            id="repair-activity-signup-phone-error"
                            role="alert"
                          >
                            {signupPhoneError}
                          </p>
                        ) : null}
                      </label>
                      <label className="field">
                        <span className="field__label">
                          {copy.issueType} <span className={styles.required}>*</span>
                        </span>
                        <select
                          className="field__input"
                          name="issueType"
                          required
                          value={signupDraft.issueType}
                          aria-invalid={signupIssueTypeError ? true : undefined}
                          aria-describedby={
                            signupIssueTypeError
                              ? "repair-activity-signup-issue-type-error"
                              : undefined
                          }
                          onChange={(event) => {
                            updateSignupDraft({ issueType: event.target.value });
                            setSignupIssueTypeError("");
                          }}
                          disabled={!open || busy}
                        >
                          {repairActivitiesPage.issueTypes.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                        {signupIssueTypeError ? (
                          <p
                            className="field__hint text-accent-deep"
                            id="repair-activity-signup-issue-type-error"
                            role="alert"
                          >
                            {signupIssueTypeError}
                          </p>
                        ) : null}
                      </label>
                      <label className="field">
                        <span className="field__label">{copy.deviceModel}</span>
                        <input
                          className="field__input"
                          name="deviceModel"
                          maxLength={REPAIR_ACTIVITY_DEVICE_MODEL_MAX_LENGTH}
                          placeholder={copy.deviceModelPlaceholder}
                          value={signupDraft.deviceModel}
                          aria-invalid={signupDeviceModelError ? true : undefined}
                          aria-describedby={
                            signupDeviceModelError
                              ? "repair-activity-signup-device-model-error"
                              : undefined
                          }
                          onChange={(event) => {
                            updateSignupDraft({ deviceModel: event.target.value });
                            setSignupDeviceModelError("");
                          }}
                          disabled={!open || busy}
                        />
                        {signupDeviceModelError ? (
                          <p
                            className="field__hint text-accent-deep"
                            id="repair-activity-signup-device-model-error"
                            role="alert"
                          >
                            {signupDeviceModelError}
                          </p>
                        ) : null}
                      </label>
                    </div>
                    <div className={styles.consentSummary}>
                      <span>
                        {consentChecked ? copy.consentSummary : copy.consentSummaryMissing}
                      </span>
                      <Button variant="ghost" onClick={() => goToStep(2)}>
                        {copy.reviewNotice}
                      </Button>
                    </div>
                    <div className={styles.stepActions}>
                      <Button variant="outline" onClick={() => goToStep(2)}>
                        {copy.previousStep}
                      </Button>
                      <Button
                        type="submit"
                        variant="solid"
                        trailingIcon="arrowRight"
                        disabled={!open || busy}
                      >
                        {busy ? copy.submitting : copy.submitSignup}
                      </Button>
                    </div>
                  </form>
                </section>

                {openedNotice ? (
                  <p className="sr-only" role="status">
                    {copy.countdownOpened}
                  </p>
                ) : null}
              </div>
            )}
          </section>

          <section className={styles.lookup} aria-labelledby="repair-activity-lookup-title">
            <h2 className="admin-panel__title" id="repair-activity-lookup-title">
              {copy.lookupTitle}
            </h2>
            <p className="muted">{copy.lookupHint}</p>
            <form className="admin-form" onSubmit={doLookup} aria-label={copy.lookupTitle}>
              <label className="field">
                <span className="field__label">{copy.name}</span>
                <input
                  ref={lookupNameInputRef}
                  className="field__input"
                  id="repair-activity-lookup-name"
                  name="name"
                  placeholder={copy.lookupNamePlaceholder}
                  required
                  minLength={2}
                  maxLength={40}
                  aria-invalid={lookupNameError ? true : undefined}
                  aria-describedby={
                    lookupNameError ? "repair-activity-lookup-name-error" : undefined
                  }
                  onInput={() => setLookupNameError("")}
                  disabled={busy}
                />
                {lookupNameError ? (
                  <p
                    className="field__hint text-accent-deep"
                    id="repair-activity-lookup-name-error"
                    role="alert"
                  >
                    {lookupNameError}
                  </p>
                ) : null}
              </label>
              <label className="field">
                <span className="field__label">{copy.phone}</span>
                <input
                  ref={lookupPhoneInputRef}
                  className="field__input"
                  id="repair-activity-lookup-phone"
                  name="phone"
                  placeholder={copy.lookupPhonePlaceholder}
                  required
                  inputMode="numeric"
                  maxLength={11}
                  aria-invalid={lookupPhoneError ? true : undefined}
                  aria-describedby={
                    lookupPhoneError ? "repair-activity-lookup-phone-error" : undefined
                  }
                  onInput={() => setLookupPhoneError("")}
                  disabled={busy}
                />
                {lookupPhoneError ? (
                  <p
                    className="field__hint text-accent-deep"
                    id="repair-activity-lookup-phone-error"
                    role="alert"
                  >
                    {lookupPhoneError}
                  </p>
                ) : null}
              </label>
              <div className="signup__actions">
                <Button type="submit" disabled={busy}>
                  {copy.submitLookup}
                </Button>
              </div>
            </form>

            {lookup ? (
              <form className="admin-form mt-s-4" onSubmit={updateType}>
                <div
                  className={`${styles.lookupResult} ${
                    lookup.status === "REGISTERED" ? styles.lookupResultSuccess : ""
                  }`}
                  role="status"
                >
                  <strong>
                    {lookup.status === "REGISTERED"
                      ? copy.lookupRegisteredTitle
                      : copy.lookupStatusLabel.replace(
                          "{status}",
                          repairActivityRegistrationStatusLabels[lookup.status] ?? lookup.status,
                        )}
                  </strong>
                  <p>
                    {lookup.name} · {lookup.phoneMasked} ·{" "}
                    {repairActivityIssueTypeLabels[lookup.issueType as RepairActivityIssueType] ??
                      lookup.issueType}
                  </p>
                  <p className={styles.signupCode}>
                    {copy.registrationNumber.replace("{id}", lookup.id)}
                  </p>
                </div>
                {lookup.status !== "REGISTERED" ? (
                  <p className="muted">{copy.notEditable}</p>
                ) : (
                  <>
                    <label className="field">
                      <span className="field__label">{copy.issueType}</span>
                      <select
                        className="field__input"
                        name="issueType"
                        required
                        disabled={busy}
                        defaultValue={lookup.issueType}
                      >
                        {repairActivitiesPage.issueTypes.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="signup__actions">
                      <Button type="submit" variant="solid" disabled={busy}>
                        {copy.submitUpdate}
                      </Button>
                      {cancelWindowOpen && lookup.status === "REGISTERED" ? (
                        <Button
                          type="button"
                          variant="outline"
                          disabled={busy || cancelBusy}
                          onClick={() => {
                            setNotice(null);
                            setProblem("");
                            setCancelOpen(true);
                          }}
                        >
                          {copy.cancelSignup}
                        </Button>
                      ) : null}
                    </div>
                    {!cancelWindowOpen ? <p className="muted">{copy.cancelStarted}</p> : null}
                  </>
                )}
              </form>
            ) : null}
            <p className="muted">{copy.cancelHint}</p>
          </section>
        </div>
      </div>

      {cancelOpen && lookup ? (
        <ConfirmDialog
          title={copy.cancelConfirmTitle}
          confirmLabel={cancelBusy ? copy.cancelling : copy.cancelConfirm}
          cancelLabel={copy.cancelKeep}
          busy={cancelBusy}
          confirmVariant="outline"
          onConfirm={() => void cancelRegistration()}
          onClose={() => {
            if (!cancelBusy) setCancelOpen(false);
          }}
        >
          <p>{copy.cancelConfirmHint}</p>
          <p className="muted">
            {lookup.name} · {lookup.phoneMasked}
          </p>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
