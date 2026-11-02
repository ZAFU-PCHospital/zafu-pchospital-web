"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import {
  formatShanghaiDateTime,
  signupCountdownParts,
} from "@/components/repair-activities/activity-format";
import { AdminToast, type AdminToastMessage } from "@/components/admin/AdminToast";
import { repairActivityStatusBadgeClass } from "@/components/repair-activities/activity-status-badge";
import { RepairActivityPrecautions } from "@/components/repair-activities/RepairActivityPrecautions";
import { RepairActivityPreparation } from "@/components/repair-activities/RepairActivityPreparation";
import { RepairActivityQueue } from "@/components/repair-activities/RepairActivityQueue";
import { fetchRegistrationDeviceStatus } from "@/features/repair-activities/registration-device-client";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { repairActivitiesPage } from "@/config/repair-activities";
import {
  activityEndExclusive,
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

type Props = { activityId: string };

/** 浏览器 setTimeout 的最大安全延时；超出会溢出并提前触发。 */
const MAX_TIMER_DELAY_MS = 2_147_483_647;

export function RepairActivityDetail({ activityId }: Props) {
  const copy = repairActivitiesPage.detail;
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [activity, setActivity] = useState<RepairActivityPublicView | null>(null);
  /** 服务器时间与本机时间之差：倒计时以服务器为准，避免本机时钟偏差。 */
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState<AdminToastMessage | null>(null);
  const [busy, setBusy] = useState(false);
  const [signupSucceeded, setSignupSucceeded] = useState(false);
  const [registrationResult, setRegistrationResult] = useState<RegistrationPublicView | null>(null);
  const [registeredPhone, setRegisteredPhone] = useState("");
  const [signupInfo, setSignupInfo] = useState("");
  const [signupPending, setSignupPending] = useState<{ name: string; phone: string } | null>(null);
  /** 待确认查询的结论：未找到时提供重新填写，查询失败时只引导重试。 */
  const [pendingCheckResult, setPendingCheckResult] = useState<"not-found" | "unknown" | null>(
    null,
  );
  const [signupPhoneError, setSignupPhoneError] = useState("");
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
  /** 待确认的表单内容；成功后保留弹层，关闭注意事项提醒时一并清除。 */
  const [pendingSignup, setPendingSignup] = useState<{
    name: string;
    phone: string;
    issueType: string;
    deviceModel: string;
  } | null>(null);
  const signupFormRef = useRef<HTMLFormElement>(null);
  const signupNameInputRef = useRef<HTMLInputElement>(null);
  const signupPhoneInputRef = useRef<HTMLInputElement>(null);
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
    setSignupSucceeded(false);
    setRegistrationResult(null);
    setRegisteredPhone("");
    setSignupInfo("");
    setSignupPending(null);
    setPendingCheckResult(null);
    setSignupPhoneError("");
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
    setPendingSignup(null);
    setBusy(false);
    setProblem("");
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
          if (registration !== undefined) setDeviceRegistration(registration);
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
          // 表单刚重新挂载，焦点回到姓名输入框。
          window.setTimeout(() => signupNameInputRef.current?.focus({ preventScroll: true }), 0);
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

  /** 排队区块只在活动开始到活动自然日结束之间出现；在边界时刻刷新可见性。 */
  useEffect(() => {
    if (!activity) return;
    const startMs = Date.parse(activity.activityAt);
    const endMs = activityEndExclusive(new Date(activity.activityAt)).getTime();
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

  /** 填好表单 → 先弹免责声明，不直接提交。 */
  function requestSignup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || submittingRef.current || pendingSignup || signupPending) return;
    setProblem("");
    setNotice(null);
    setSignupInfo("");
    const data = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    const phone = (data.phone ?? "").trim();
    if (!CN_MOBILE_PATTERN.test(phone)) {
      setSignupPhoneError(copy.phoneFormatHint);
      signupPhoneInputRef.current?.focus();
      return;
    }
    setSignupPhoneError("");
    setPendingSignup({
      name: data.name ?? "",
      phone,
      issueType: data.issueType ?? "",
      deviceModel: data.deviceModel ?? "",
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
  async function handleUncertainSignup(
    pending: NonNullable<typeof pendingSignup>,
    attempt: number,
  ) {
    const outcome = await lookupRegistration(pending.name, pending.phone);
    if (signupAttemptRef.current !== attempt) return;
    if (outcome.kind === "found") {
      setSignupSucceeded(true);
      setRegistrationResult(outcome.data);
      setDeviceRegistration(outcome.data);
      setRegisteredPhone(pending.phone);
      setSignupInfo("");
      setSignupPending(null);
      setPendingCheckResult(null);
      setNotice({ text: copy.lookupConfirmed, tone: "success" });
      void load(true);
      return;
    }
    setPendingSignup(null);
    setSignupPending({ name: pending.name, phone: pending.phone });
    setPendingCheckResult(outcome.kind === "not-found" ? "not-found" : "unknown");
    setSignupInfo(outcome.kind === "not-found" ? copy.lookupNotFoundRetry : copy.lookupFailedRetry);
  }

  /** 弹层里点过「我已阅读并同意」之后才真正提交。 */
  async function confirmSignup() {
    if (!pendingSignup || submittingRef.current) return;
    const pending = pendingSignup;
    const attempt = ++signupAttemptRef.current;
    submittingRef.current = true;
    setBusy(true);
    setProblem("");
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
        error?: { code?: string; message?: string };
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
        // 失败要让报名者看得见原因，而错误提示在弹层后面 —— 先关弹层再报错。
        setPendingSignup(null);
        setRegisteredPhone(pending.phone);
        if (json.error?.code === "ACTIVITY_DEVICE_ALREADY_REGISTERED") {
          // 另一个 tab 已报过 / 本地状态没跟上：直接切到「已提交」面板，而不是只报一条错误。
          let registration: RegistrationPublicView | null | undefined;
          try {
            registration = await fetchRegistrationDeviceStatus(activityId);
          } catch {
            registration = undefined;
          }
          if (signupAttemptRef.current !== attempt) return;
          if (registration) {
            setDeviceRegistration(registration);
            setSignupInfo("");
            setNotice({ text: copy.deviceRegisteredTitle, tone: "neutral" });
            focusLookup(undefined, registration.name);
          } else {
            // 设备 409 与「当前手机号重复」无关，不能用 duplicateHint 的文案。
            setSignupInfo(json.error?.message ?? copy.deviceConflictFallback);
          }
        } else if (json.error?.code === "ACTIVITY_REGISTRATION_DUPLICATE") {
          setSignupInfo(copy.duplicateHint);
        } else if (json.error?.code === "ACTIVITY_FULL") {
          setSignupInfo(copy.fullLookupHint);
        } else {
          setProblem(json.error?.message ?? "报名失败");
        }
      } else {
        setSignupSucceeded(true);
        setRegistrationResult(json.data ?? null);
        setDeviceRegistration(json.data ?? null);
        setRegisteredPhone(pending.phone);
        setSignupInfo("");
        setSignupPending(null);
        signupFormRef.current?.reset();
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
      setSignupInfo("");
      setNotice({ text: copy.lookupConfirmed, tone: "success" });
      void load(true);
    } else {
      setPendingCheckResult(outcome.kind === "not-found" ? "not-found" : "unknown");
      setSignupInfo(
        outcome.kind === "not-found" ? copy.lookupNotFoundRetry : copy.lookupFailedRetry,
      );
    }
    setBusy(false);
  }

  /** 查询确认未报名后，解除待确认并允许重新填写；重复提交仍由服务端判重兜底。 */
  function restartPendingSignup() {
    setSignupPending(null);
    setPendingCheckResult(null);
    setSignupInfo("");
    setSignupPhoneError("");
    signupFormRef.current?.reset();
    signupPhoneInputRef.current?.focus({ preventScroll: true });
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

  function closeSignupDialog() {
    // 报名成功后表单已收起，焦点退到查询区姓名输入框，避免落到 body。
    (signupFormRef.current ?? lookupNameInputRef.current)?.focus({ preventScroll: true });
    setPendingSignup(null);
    setSignupSucceeded(false);
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
        setRegistrationResult(outcome.data);
        setDeviceRegistration(outcome.data);
        setSignupInfo("");
        signupFormRef.current?.reset();
        void load(true);
      }
    } else if (matchesPending) {
      setPendingCheckResult(outcome.kind === "not-found" ? "not-found" : "unknown");
      setSignupInfo(
        outcome.kind === "not-found" ? copy.lookupNotFoundRetry : copy.lookupFailedRetry,
      );
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
        <p className="admin-status admin-status--error" role="alert">
          {problem}
        </p>
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
            <dd>{formatShanghaiDateTime(activity.activityAt)}</dd>
          </div>
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
        <p className="admin-status admin-status--error" role="alert">
          {problem}
        </p>
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
            <h2 className="admin-panel__title" id="repair-activity-signup-title">
              {copy.signupTitle}
            </h2>
            {registrationResult ? (
              <div className={styles.signupResult} role="status">
                <strong>{copy.signupSuccessTitle}</strong>
                <p>{activity.title}</p>
                <p>
                  {registrationResult.name} · {registrationResult.phoneMasked}
                </p>
                <p>
                  {copy.receiptIssueType.replace(
                    "{type}",
                    repairActivityIssueTypeLabels[
                      registrationResult.issueType as RepairActivityIssueType
                    ] ?? registrationResult.issueType,
                  )}
                </p>
                <p>
                  {copy.receiptStatus.replace(
                    "{status}",
                    repairActivityRegistrationStatusLabels[registrationResult.status] ??
                      registrationResult.status,
                  )}
                </p>
                <p className={styles.signupCode}>
                  {copy.registrationNumber.replace("{id}", registrationResult.id)}
                </p>
                <p className="muted">{copy.registeredHint}</p>
                <p className="muted">{copy.contactAdminHint}</p>
                <Button
                  variant="ghost"
                  onClick={() => focusLookup(registeredPhone, registrationResult.name)}
                >
                  {copy.lookupMine}
                </Button>
              </div>
            ) : null}
            {/* 本设备已提交：收起表单，只保留查询 / 联系管理员的出口（issue #304）。 */}
            {!registrationResult && deviceRegistration ? (
              <div className={styles.signupResult} role="status">
                <strong>{copy.deviceRegisteredTitle}</strong>
                <p>
                  {deviceRegistration.name} · {deviceRegistration.phoneMasked}
                </p>
                <p>
                  {copy.receiptIssueType.replace(
                    "{type}",
                    repairActivityIssueTypeLabels[
                      deviceRegistration.issueType as RepairActivityIssueType
                    ] ?? deviceRegistration.issueType,
                  )}
                </p>
                <p className="muted">{copy.deviceRegisteredHint}</p>
                <div className={styles.signupPendingActions}>
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
            ) : null}
            {signupPending ? (
              <div className={styles.signupPending} role="status">
                <strong>{copy.signupPendingTitle}</strong>
                <p className="muted">{copy.signupPendingHint}</p>
                <div className={styles.signupPendingActions}>
                  <Button variant="ghost" onClick={() => void checkPendingSignup()} disabled={busy}>
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
            ) : null}
            {signupInfo ? (
              <div className={styles.signupNotice}>
                <p role="status">{signupInfo}</p>
                <Button variant="ghost" onClick={() => focusLookup(registeredPhone)}>
                  {copy.lookupMine}
                </Button>
              </div>
            ) : null}{" "}
            {!open ? <p className="muted">{signupDisabledReason}</p> : null}
            {activity.status === "FULL" && !registrationResult ? (
              <div className={styles.fullHint}>
                <p className="muted">{copy.fullLookupHint}</p>
                <Button variant="ghost" onClick={() => focusLookup()}>
                  {copy.lookupMine}
                </Button>
              </div>
            ) : null}
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
            {openedNotice ? (
              <p className="sr-only" role="status">
                {copy.countdownOpened}
              </p>
            ) : null}
            {!deviceStatusResolved && !registrationResult ? (
              <p className="muted" role="status">
                {copy.deviceStatusChecking}
              </p>
            ) : null}
            {!deviceStatusResolved || deviceRegistration || registrationResult ? null : (
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
                      name="name"
                      placeholder={copy.namePlaceholder}
                      required
                      minLength={2}
                      maxLength={40}
                      disabled={!open || busy}
                    />
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
                      aria-invalid={signupPhoneError ? true : undefined}
                      aria-describedby={
                        signupPhoneError ? "repair-activity-signup-phone-error" : undefined
                      }
                      onInput={() => setSignupPhoneError("")}
                      disabled={!open || busy || signupPending !== null}
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
                      disabled={!open || busy}
                      defaultValue="CLEAN_PASTE"
                    >
                      {repairActivitiesPage.issueTypes.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span className="field__label">{copy.deviceModel}</span>
                    <input
                      className="field__input"
                      name="deviceModel"
                      maxLength={REPAIR_ACTIVITY_DEVICE_MODEL_MAX_LENGTH}
                      placeholder={copy.deviceModelPlaceholder}
                      disabled={!open || busy}
                    />
                  </label>
                </div>
                <p className="muted">{copy.signupConsentHint}</p>
                <div className="signup__actions">
                  <Button
                    type="submit"
                    variant="solid"
                    trailingIcon="arrowRight"
                    disabled={!open || busy || signupPending !== null}
                  >
                    {busy ? "提交中…" : copy.submitSignup}
                  </Button>
                </div>
              </form>
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
                      {cancelWindowOpen ? (
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

      {/* 提交前确认完整声明，成功后在同一弹层展示到场准备。
          服务端同样强制同意，绕开确认直接打接口会拿到 400。 */}
      {pendingSignup ? (
        <ConfirmDialog
          title={signupSucceeded ? copy.signupSuccessTitle : copy.consent.title}
          confirmLabel={signupSucceeded ? copy.acknowledgePrecautions : copy.consent.agree}
          cancelLabel={signupSucceeded ? undefined : copy.confirmEdit}
          busy={!signupSucceeded && busy}
          onConfirm={signupSucceeded ? closeSignupDialog : () => void confirmSignup()}
          onClose={closeSignupDialog}
        >
          {!signupSucceeded && pendingSignup ? (
            <div className={styles.signupConfirm}>
              <dl className={styles.signupConfirmList}>
                <div>
                  <dt>{copy.confirmActivity}</dt>
                  <dd>{activity.title}</dd>
                </div>
                <div>
                  <dt>{copy.name}</dt>
                  <dd>{pendingSignup.name}</dd>
                </div>
                <div>
                  <dt>{copy.phone}</dt>
                  <dd>{pendingSignup.phone}</dd>
                </div>
              </dl>
              <p className="muted">{copy.confirmIdentityHint}</p>
            </div>
          ) : null}
          <div className="admin-section">
            <p className="muted">{signupSucceeded ? copy.signupSuccess : copy.consent.subtitle}</p>
            {signupSucceeded ? <RepairActivityPreparation /> : <RepairActivityPrecautions />}
          </div>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
