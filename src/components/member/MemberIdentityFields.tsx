import { memberCopy } from "@/config/member";
import { formatShanghaiDate } from "@/lib/shanghai-date";
import type { RoleCode } from "@/types/contracts";

/**
 * MemberIdentityFields —— 只读身份字段表
 *
 * 用 `<dl>` 语义，**不渲染成输入框** —— 这些字段（实名/学号/班级/加入时间/角色）
 * 由管理员维护，M3 不支持自助修改。假输入框会让用户以为可以改。
 *
 * QQ 只在自我视图与内部（他人）视图出现，且带「内部可见」标记；
 * 页面级可见性由服务端 `ProfileVisibilityPolicy` 保证，这里只负责如实标注。
 */

export type IdentityField = {
  label: string;
  value: string | null;
  /** true 时渲染为「未填写」的弱化样式 */
  muted?: boolean;
  /** 值的可见性提示，如「内部可见」 */
  visibilityTag?: string;
};

export type MemberIdentityFieldsProps = {
  fields: readonly IdentityField[];
};

export function MemberIdentityFields({ fields }: MemberIdentityFieldsProps) {
  return (
    <dl className="member-fields">
      {fields.map((field) => (
        <div className="member-field" key={field.label}>
          <dt className="member-field__label">
            {field.label}
            {field.visibilityTag ? (
              <span className="member-tag member-tag--muted">{field.visibilityTag}</span>
            ) : null}
          </dt>
          <dd className={`member-field__value ${field.muted ? "member-field__value--muted" : ""}`}>
            {field.value ?? memberCopy.profile.notProvided}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** 角色代码 → 中文标签。未知代码原样显示，不猜。 */
export function roleLabel(code: RoleCode | string): string {
  return memberCopy.common.roleLabels[code] ?? code;
}

/** 角色列表 → 顿号连接的中文标签，空数组显示未填写。 */
export function roleLabels(roles: readonly (RoleCode | string)[]): string | null {
  if (!roles.length) return null;
  return roles.map(roleLabel).join("、");
}

/** 加入时间格式化（Asia/Shanghai 自然日）。 */
export function joinedAtLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return formatShanghaiDate(value);
}
