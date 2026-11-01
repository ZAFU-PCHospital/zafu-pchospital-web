import type { ReactNode, SVGProps } from "react";

/**
 * 图标
 *
 * 设计基准 Demo 使用内联 SVG 线性图标（24 格、stroke 2、round 端点）。
 * 这里把用到的图标集中成一份，避免各页面零散粘贴 SVG 造成风格漂移。
 * 新增图标时保持同样的画布、线宽与端点规则。
 */

export type IconName =
  | "menu"
  | "close"
  | "book"
  | "chevronRight"
  | "chevronLeft"
  | "chevronDown"
  | "arrowDown"
  | "arrowUpRight"
  | "arrowRight"
  | "undo"
  | "fileText"
  | "github"
  | "eye"
  | "eyeOff"
  | "zoomIn"
  | "zoomOut"
  | "sun"
  | "moon"
  // M6 管理后台需要的最小集：新增/编辑/删除/导出/通过。仍遵守 24 格、stroke 2、round 端点。
  | "plus"
  | "edit"
  | "trash"
  | "download"
  | "check"
  | "grip"
  /**
   * 列级筛选（M6 批 2 的表格内核）。
   *
   * 图标集里原本没有「筛选」，而筛选入口不给图标就说不出它是干什么的 ——
   * 一排纯文字按钮里，「列筛选」看起来和旁边的动作按钮没有区别。
   */
  | "filter"
  /* 工作台重构：移动端标签栏与首页快捷入口用的一套线性图标。 */
  | "home"
  | "wrench"
  | "bell"
  | "user"
  | "users"
  | "clipboard"
  | "trophy"
  | "heart"
  | "key"
  | "folder"
  | "tag"
  | "message"
  | "shield"
  | "sliders"
  | "calendar"
  | "hardDrive"
  | "plug"
  | "package";

const shapes: Record<IconName, ReactNode> = {
  hardDrive: (
    <>
      <path d="M5 4h14l3 9v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-6z" />
      <path d="M2 13h20M6 17h.01M10 17h.01" />
    </>
  ),
  plug: (
    <>
      <path d="M8 3v5M16 3v5M6 8h12v5a6 6 0 0 1-12 0zM12 19v3" />
    </>
  ),
  package: (
    <>
      <path d="m12 3 9 5v8l-9 5-9-5V8zM3 8l9 5 9-5M12 13v8M7.5 5.5l9 5" />
    </>
  ),
  menu: (
    <>
      <line x1="4" x2="20" y1="12" y2="12" />
      <line x1="4" x2="20" y1="6" y2="6" />
      <line x1="4" x2="20" y1="18" y2="18" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  edit: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M4 20h16" />
    </>
  ),
  check: (
    <>
      <path d="m4 12 5 5L20 6" />
    </>
  ),
  close: (
    <>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </>
  ),
  book: (
    <>
      <path d="M12 7v14" />
      <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
    </>
  ),
  chevronRight: <path d="m9 18 6-6-6-6" />,
  chevronLeft: <path d="m15 18-6-6 6-6" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  arrowDown: (
    <>
      <path d="M12 5v14" />
      <path d="m19 12-7 7-7-7" />
    </>
  ),
  arrowUpRight: (
    <>
      <path d="M7 7h10v10" />
      <path d="M7 17 17 7" />
    </>
  ),
  /* 活动工作台队列处理按钮：接待=右向箭头，撤回=Undo（逆时针回转）。 */
  arrowRight: (
    <>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </>
  ),
  undo: (
    <>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </>
  ),
  fileText: (
    <>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M10 9H8" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
    </>
  ),
  github: (
    <>
      <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3.3-.4 6.8-1.6 6.8-7.4A5.8 5.8 0 0 0 18.2 3a5.4 5.4 0 0 0-.1-2.8S17.1-.2 15 1.8a13.4 13.4 0 0 0-7 0C5.9-.2 4.9.2 4.9.2A5.4 5.4 0 0 0 4.8 3a5.8 5.8 0 0 0-1.6 4.1c0 5.8 3.5 7 6.8 7.4A4.8 4.8 0 0 0 9 18v4" />
      <path d="M9 19c-3 .9-3-1.5-4.2-2" />
    </>
  ),
  eye: (
    <>
      <path d="M2.1 12s3.6-7 9.9-7 9.9 7 9.9 7-3.6 7-9.9 7-9.9-7-9.9-7Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: (
    <>
      <path d="m3 3 18 18" />
      <path d="M10.6 5.2Q11.3 5 12 5c6.3 0 9.9 7 9.9 7a16 16 0 0 1-2.4 3.4" />
      <path d="M6.1 6.1C3.5 8 2.1 12 2.1 12s3.6 7 9.9 7c1.6 0 3-.4 4.2-1" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </>
  ),
  zoomIn: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
      <path d="M11 8v6" />
      <path d="M8 11h6" />
    </>
  ),
  zoomOut: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
      <path d="M8 11h6" />
    </>
  ),
  /* 正常模式 / 深色模式：主题切换入口使用。两者互为对照，线宽与端点规则与其他图标一致。 */
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </>
  ),
  moon: <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />,
  /**
   * 拖动排序的手柄。
   *
   * 两个竖列各三个点：这是「可拖动」最通用的画法（同一条线段的 `menu` 图标
   * 会被读成「打开菜单」）。点是实心圆，因此这里单独覆盖 fill / stroke ——
   * 图标集其余形状都是描边，只有它是实心。
   */
  grip: (
    <g fill="currentColor" stroke="none">
      <circle cx="9" cy="6" r="1.4" />
      <circle cx="15" cy="6" r="1.4" />
      <circle cx="9" cy="12" r="1.4" />
      <circle cx="15" cy="12" r="1.4" />
      <circle cx="9" cy="18" r="1.4" />
      <circle cx="15" cy="18" r="1.4" />
    </g>
  ),
  /** 漏斗：口宽、颈窄、下口收成一条斜切 —— 与图标集其余形状同样 24 格、stroke 2、圆端点。 */
  filter: <path d="M4 5h16l-6 7.5V19l-4-2.5v-4z" />,
  home: (
    <>
      <path d="m3 10 9-7 9 7" />
      <path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" />
    </>
  ),
  wrench: (
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
  ),
  bell: (
    <>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </>
  ),
  user: (
    <>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </>
  ),
  users: (
    <>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  clipboard: (
    <>
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <path d="M9 12h6" />
      <path d="M9 16h6" />
    </>
  ),
  trophy: (
    <>
      <path d="M8 21h8" />
      <path d="M12 17v4" />
      <path d="M7 4h10v6a5 5 0 0 1-10 0V4z" />
      <path d="M7 6H4a1 1 0 0 0-1 1c0 2.5 2 4 4 4" />
      <path d="M17 6h3a1 1 0 0 1 1 1c0 2.5-2 4-4 4" />
    </>
  ),
  heart: (
    <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7z" />
  ),
  key: (
    <>
      <circle cx="7.5" cy="15.5" r="4.5" />
      <path d="m11 12 10-10" />
      <path d="m15 8 3 3" />
    </>
  ),
  folder: (
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z" />
  ),
  tag: (
    <>
      <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" />
      <circle cx="7.5" cy="7.5" r="1" />
    </>
  ),
  message: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  shield: (
    <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1 1 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
  ),
  sliders: (
    <>
      <line x1="4" x2="7" y1="6" y2="6" />
      <line x1="11" x2="20" y1="6" y2="6" />
      <circle cx="9" cy="6" r="2" />
      <line x1="4" x2="13" y1="12" y2="12" />
      <line x1="17" x2="20" y1="12" y2="12" />
      <circle cx="15" cy="12" r="2" />
      <line x1="4" x2="6" y1="18" y2="18" />
      <line x1="10" x2="20" y1="18" y2="18" />
      <circle cx="8" cy="18" r="2" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4" />
      <path d="M8 2v4" />
      <path d="M3 10h18" />
    </>
  ),
};

export type IconProps = { name: IconName } & SVGProps<SVGSVGElement>;

export function Icon({ name, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {shapes[name]}
    </svg>
  );
}
