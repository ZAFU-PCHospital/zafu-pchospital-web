"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { memberRepairActivitiesCopy } from "@/config/repair-activities";

type Props = {
  activityId: string;
  registrationId: string;
  phoneMasked: string;
  onError: (message: string) => void;
};

/** 两个列表共用；隐藏时丢弃明文，再次查看重新鉴权取数。 */
export function RegistrationPhone({ activityId, registrationId, phoneMasked, onError }: Props) {
  const copy = memberRepairActivitiesCopy.board;
  const [phone, setPhone] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const request = useRef<AbortController | null>(null);

  useEffect(() => () => request.current?.abort(), []);

  async function toggle() {
    if (request.current) return;
    if (phone !== null) {
      setPhone(null);
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    try {
      const response = await fetch(
        `/api/v1/member/repair-activities/${activityId}/registrations/${registrationId}/phone`,
        { cache: "no-store", signal: controller.signal },
      );
      const json = (await response.json()) as {
        success: boolean;
        data?: { phone: string };
      };
      if (!response.ok || !json.success || !json.data) throw new Error(copy.phoneLoadFailed);
      if (!controller.signal.aborted) setPhone(json.data.phone);
    } catch {
      if (!controller.signal.aborted) onError(copy.phoneLoadFailed);
    } finally {
      if (!controller.signal.aborted) {
        request.current = null;
        setLoading(false);
      }
    }
  }

  return (
    <span className="activity-board__phone">
      <span className="activity-board__phone-number">{phone ?? phoneMasked}</span>
      <Button
        variant="ghost"
        className="activity-board__phone-toggle"
        icon={phone !== null ? "eyeOff" : "eye"}
        aria-label={loading ? copy.phoneLoading : phone !== null ? copy.hidePhone : copy.showPhone}
        disabled={loading}
        onClick={() => void toggle()}
      >
        {null}
      </Button>
    </span>
  );
}
