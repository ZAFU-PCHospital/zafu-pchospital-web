import { requestJson } from "@/lib/client/request";

/** 看板三个读取视图共用单飞、失效与退避；写操作不经过这里。 */
export type BoardReadState<T> = {
  data: T | null;
  pending: boolean;
  lastSuccessAt: number | null;
  failures: number;
  error: string | null;
  stopped: boolean;
};
type Options<T> = {
  url: string;
  interval: () => number;
  paused: () => boolean;
  changed: () => void;
  succeeded?: (data: T) => void;
};

export function boardRetryDelay(interval: number, failures: number): number {
  return Math.min(interval * 2 ** Math.min(failures, 6), interval >= 60_000 ? 120_000 : 60_000);
}

export function createBoardReader<T>(options: Options<T>) {
  let state: BoardReadState<T> = {
    data: null,
    pending: false,
    lastSuccessAt: null,
    failures: 0,
    error: null,
    stopped: false,
  };
  let due = 0;
  let disposed = false;
  let active: {
    controller: AbortController;
    background: boolean;
    promise: Promise<T | null>;
  } | null = null;
  const change = (patch: Partial<BoardReadState<T>>) => {
    state = { ...state, ...patch };
    options.changed();
  };
  const invalidate = (backgroundOnly = false) => {
    if (backgroundOnly && !active?.background) return;
    const previous = active;
    active = null;
    previous?.controller.abort();
    if (state.pending && !disposed) change({ pending: false });
  };
  return {
    get state() {
      return state;
    },
    invalidate,
    dispose() {
      disposed = true;
      invalidate();
    },
    update(update: (data: T) => T) {
      if (state.data) change({ data: update(state.data) });
    },
    read({ manual = false, resume = false } = {}): Promise<T | null> {
      if (disposed) return Promise.resolve(null);
      if (active) return active.promise;
      if (!manual && (state.stopped || options.paused() || document.visibilityState !== "visible"))
        return Promise.resolve(null);
      if (!manual && Date.now() < due && !(resume && state.failures === 0))
        return Promise.resolve(null);
      const request: {
        controller: AbortController;
        background: boolean;
        promise: Promise<T | null>;
      } = {
        controller: new AbortController(),
        background: !manual,
        promise: Promise.resolve(null),
      };
      active = request;
      change({ pending: true });
      request.promise = (async () => {
        try {
          const json = await requestJson<T>(options.url, {
            cache: "no-store",
            signal: request.controller.signal,
          });
          if (active !== request || disposed) return null;
          if (request.background && (options.paused() || document.visibilityState !== "visible"))
            return null;
          options.succeeded?.(json.data);
          due = Date.now() + options.interval();
          change({
            data: json.data,
            lastSuccessAt: Date.now(),
            failures: 0,
            error: null,
            stopped: false,
          });
          return json.data;
        } catch (error) {
          if (active !== request || disposed) return null;
          const failures = state.failures + 1;
          due = Date.now() + boardRetryDelay(options.interval(), failures);
          change({
            failures,
            error: error instanceof Error ? error.message : "",
            stopped: [401, 403, 404].includes((error as { status?: number })?.status ?? 0),
          });
          return null;
        } finally {
          if (active === request) {
            active = null;
            change({ pending: false });
          }
        }
      })();
      return request.promise;
    },
  };
}
