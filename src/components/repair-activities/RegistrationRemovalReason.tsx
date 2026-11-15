"use client";

import { useId } from "react";
import { registrationRemovalCopy, registrationRemovalReasons } from "@/config/repair-activities";

export function RegistrationRemovalReason({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const id = useId();
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {registrationRemovalCopy.label}
      </label>
      <select
        id={id}
        className="field__input"
        required
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{registrationRemovalCopy.placeholder}</option>
        {registrationRemovalReasons.map((reason) => (
          <option key={reason} value={reason}>
            {reason}
          </option>
        ))}
      </select>
    </div>
  );
}
