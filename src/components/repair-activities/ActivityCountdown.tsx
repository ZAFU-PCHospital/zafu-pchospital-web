"use client";

import { useEffect, useState } from "react";

import { signupCountdownParts } from "@/components/repair-activities/activity-format";
import { repairActivitiesPage } from "@/config/repair-activities";

const copy = repairActivitiesPage.detail;

type Props = {
  /** 报名开始时刻（ISO）。 */
  signupOpensAt: string;
  /** 服务器与本机的时差：倒计时以服务器时间为准，避免本机时钟偏差。 */
  serverOffsetMs: number;
  /** 已格式化好的「X 开放」提示；父级算一次即可，避免每秒重复格式化。 */
  opensHint: string;
};

/**
 * 报名倒计时叶子组件。
 *
 * 每秒 tick 只发生在这一层：父级 `RepairActivityDetail` 不再持有 1 秒 state，
 * 整页不会每秒重渲染。数字块仍不进 live region——读屏播报由父级在状态翻转时
 * 一次性发出（`role="status"` 的那条 sr-only 文案），行为与本组件无关。
 *
 * 时间基准：`Date.now() + serverOffsetMs`，与父级判断边界用的是同一套校正。
 */
export function ActivityCountdown({ signupOpensAt, serverOffsetMs, opensHint }: Props) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const opensAtMs = Date.parse(signupOpensAt);
  const remainingMs = Number.isFinite(opensAtMs)
    ? opensAtMs - (nowMs + serverOffsetMs)
    : Number.POSITIVE_INFINITY;
  const countdown = signupCountdownParts(remainingMs);

  return (
    <div className="activity-countdown" role="timer">
      <p className="activity-countdown__label">{copy.countdownPrefix}</p>
      {remainingMs <= 0 ? (
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
                  <span className="activity-countdown__unit">{copy.countdownUnits.days}</span>
                </span>
                <span className="activity-countdown__colon" aria-hidden="true">
                  :
                </span>
              </>
            ) : null}
            <span className="activity-countdown__block">
              <span className="activity-countdown__num">{countdown.hours}</span>
              <span className="activity-countdown__unit">{copy.countdownUnits.hours}</span>
            </span>
            <span className="activity-countdown__colon" aria-hidden="true">
              :
            </span>
            <span className="activity-countdown__block">
              <span className="activity-countdown__num">{countdown.minutes}</span>
              <span className="activity-countdown__unit">{copy.countdownUnits.minutes}</span>
            </span>
            <span className="activity-countdown__colon" aria-hidden="true">
              :
            </span>
            <span className="activity-countdown__block">
              <span className="activity-countdown__num">{countdown.seconds}</span>
              <span className="activity-countdown__unit">{copy.countdownUnits.seconds}</span>
            </span>
          </div>
          <p className="activity-countdown__hint">{opensHint}</p>
        </>
      )}
    </div>
  );
}
