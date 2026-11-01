import { AppError } from "@/lib/api/errors";

export type BoundedGateOptions = {
  maxActive: number;
  maxWaiting: number;
  waitTimeoutMs: number;
  busyMessage: string;
  timeoutMessage: string;
};

export type BoundedGate = {
  acquire(signal?: AbortSignal): Promise<() => void>;
  snapshot(): { active: number; waiting: number };
};

type Waiter = {
  resolve: (release: () => void) => void;
  reject: (error: AppError) => void;
  timer: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  onAbort?: () => void;
};

/**
 * 进程内有界闸门：最多 `maxActive` 个持有者，等待队列最多 `maxWaiting` 个。
 * 名额满时立即拒绝；排队超时或请求取消同样拒绝，且不会占着名额。
 */
export function createBoundedGate(options: BoundedGateOptions): BoundedGate {
  let active = 0;
  const waiting: Waiter[] = [];

  function busy(): AppError {
    return new AppError("RATE_LIMITED", options.busyMessage);
  }

  function removeWaiter(waiter: Waiter): void {
    const index = waiting.indexOf(waiter);
    if (index >= 0) waiting.splice(index, 1);
    clearTimeout(waiter.timer);
    waiter.signal?.removeEventListener("abort", waiter.onAbort!);
  }

  function activateNext(): void {
    if (active >= options.maxActive) return;
    const waiter = waiting.shift();
    if (!waiter) return;
    clearTimeout(waiter.timer);
    waiter.signal?.removeEventListener("abort", waiter.onAbort!);
    active += 1;
    waiter.resolve(makeRelease());
  }

  function releaseSlot(): void {
    active -= 1;
    activateNext();
  }

  function makeRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      releaseSlot();
    };
  }

  return {
    acquire(signal) {
      if (signal?.aborted) return Promise.reject(busy());
      if (active < options.maxActive) {
        active += 1;
        return Promise.resolve(makeRelease());
      }
      if (waiting.length >= options.maxWaiting) return Promise.reject(busy());

      return new Promise<() => void>((resolve, reject) => {
        const waiter: Waiter = {
          resolve,
          reject,
          timer: setTimeout(() => {
            removeWaiter(waiter);
            reject(new AppError("RATE_LIMITED", options.timeoutMessage));
          }, options.waitTimeoutMs),
          signal,
        };
        (waiter.timer as { unref?: () => void }).unref?.();
        waiter.onAbort = () => {
          removeWaiter(waiter);
          reject(busy());
        };
        signal?.addEventListener("abort", waiter.onAbort, { once: true });
        waiting.push(waiter);
      });
    },
    snapshot() {
      return { active, waiting: waiting.length };
    },
  };
}

export const repairPhotoAdmissionConfig = {
  upload: { maxActive: 1, maxWaiting: 1, waitTimeoutMs: 5_000 },
  image: { maxActive: 1, maxWaiting: 1, waitTimeoutMs: 5_000 },
} as const;

type RepairPhotoGates = {
  upload: BoundedGate;
  image: BoundedGate;
};

type GateScope = typeof globalThis & {
  __zafuRepairPhotoGates?: RepairPhotoGates;
};

function gates(): RepairPhotoGates {
  const scope = globalThis as GateScope;
  scope.__zafuRepairPhotoGates ??= {
    upload: createBoundedGate({
      ...repairPhotoAdmissionConfig.upload,
      busyMessage: "当前已有照片上传正在处理，请稍后重试",
      timeoutMessage: "照片上传排队超时，请稍后重试",
    }),
    image: createBoundedGate({
      ...repairPhotoAdmissionConfig.image,
      busyMessage: "图片处理繁忙，请稍后重试",
      timeoutMessage: "图片处理排队超时，请稍后重试",
    }),
  };
  return scope.__zafuRepairPhotoGates;
}

/** 上传入口在 `request.formData()` 之前取名额，避免排队请求先缓存整批文件。 */
export const repairPhotoUploadGate = gates().upload;

/** 图像解码与两种变体生成共用同一个名额：生产机同一时刻只处理一张图。 */
export const repairPhotoImageGate = gates().image;

export async function withRepairPhotoImageSlot<T>(run: () => Promise<T>): Promise<T> {
  const release = await repairPhotoImageGate.acquire();
  try {
    return await run();
  } finally {
    release();
  }
}
