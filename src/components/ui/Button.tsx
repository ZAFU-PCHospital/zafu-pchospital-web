import Link from "next/link";
import type { ComponentPropsWithRef, ReactNode } from "react";

import { cn } from "@/lib/utils";

import { Icon, type IconName } from "./Icon";

/**
 * Button —— 全站唯一按钮
 *
 * 对应设计系统中的 `.btn` / `.btn--solid` / `.btn--ghost`。
 * 禁止在页面里另写一套按钮样式。
 *
 * - outline（默认）：描边按钮
 * - solid：信号黄实心按钮，用于页面主行动点
 * - ghost：无边框文字按钮，带下划线展开动效
 *
 * 有 href 时渲染为链接（站内走 next/link，external 时新窗口打开），
 * 否则渲染为原生 button。
 */

export type ButtonVariant = "outline" | "solid" | "ghost";

type BaseProps = {
  variant?: ButtonVariant;
  /** 前置图标 */
  icon?: IconName;
  /** 后置图标 */
  trailingIcon?: IconName;
  className?: string;
  children: ReactNode;
};

export type LinkButtonProps = BaseProps & {
  href: string;
  /** 外部链接：新窗口打开并加 rel="noopener noreferrer" */
  external?: boolean;
};

export type NativeButtonProps = BaseProps &
  Omit<ComponentPropsWithRef<"button">, keyof BaseProps> & { href?: never };

export type ButtonProps = LinkButtonProps | NativeButtonProps;

const variantClass: Record<ButtonVariant, string> = {
  outline: "",
  solid: "btn--solid",
  ghost: "btn--ghost",
};

export function Button(props: ButtonProps) {
  const { variant = "outline", icon, trailingIcon, className, children, ...elementProps } = props;
  const classes = cn("btn", variantClass[variant], className);

  const content = (
    <>
      {icon ? <Icon name={icon} /> : null}
      <span>{children}</span>
      {trailingIcon ? <Icon name={trailingIcon} /> : null}
    </>
  );

  if (typeof props.href === "string") {
    const { href, external } = props;

    if (external) {
      return (
        <a className={classes} href={href} target="_blank" rel="noopener noreferrer">
          {content}
        </a>
      );
    }

    return (
      <Link className={classes} href={href}>
        {content}
      </Link>
    );
  }

  const nativeProps = elementProps as Omit<NativeButtonProps, keyof BaseProps>;

  return (
    <button {...nativeProps} className={classes} type={nativeProps.type ?? "button"}>
      {content}
    </button>
  );
}
