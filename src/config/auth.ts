export const loginCopy = {
  brandMark: "PC",
  brandName: "ZAFU PC HOSPITAL",
  eyebrow: "Member Access",
  title: "成员登录",
  lead: "登录电脑医院综合服务平台，继续处理维修记录与成员事务。",
  qqLabel: "QQ 号",
  qqPlaceholder: "请输入已绑定的 QQ 号",
  passwordLabel: "密码",
  passwordPlaceholder: "请输入密码",
  showPassword: "显示密码",
  hidePassword: "隐藏密码",
  rememberMe: "保持登录状态",
  sessionExpired: "登录状态已过期，请重新登录",
  submit: "登录",
  submitting: "登录中",
  failed: "登录失败",
  /** 有邀请码：在本页切换到注册 */
  registerPrompt: "已有邀请码？",
  registerAction: "使用邀请码注册",
  /** 无邀请码：走公开招新，不嵌入 /join 表单 */
  joinPrompt: "没有邀请码？",
  joinAction: "去加入我们",
  backHome: "返回首页",
} as const;

export const registerCopy = {
  brandMark: "PC",
  brandName: "ZAFU PC HOSPITAL",
  eyebrow: "Invite Register",
  title: "邀请码注册",
  lead: "持有效邀请码登记成员身份并设置登录密码。没有邀请码请走公开招新。",
  groupInvite: "① 邀请码",
  groupIdentity: "② 身份信息",
  groupPassword: "③ 设置密码",
  codeLabel: "邀请码",
  codePlaceholder: "请输入邀请码",
  realNameLabel: "姓名",
  realNamePlaceholder: "请输入真实姓名",
  qqLabel: "QQ 号",
  qqPlaceholder: "请输入 QQ 号",
  phoneLabel: "手机号",
  phonePlaceholder: "请输入手机号",
  studentIdLabel: "学号（选填）",
  studentIdPlaceholder: "选填",
  classNameLabel: "班级（选填）",
  classNamePlaceholder: "选填",
  passwordLabel: "密码",
  passwordPlaceholder: "设置登录密码",
  passwordConfirmLabel: "确认密码",
  passwordConfirmPlaceholder: "再次输入密码",
  showPassword: "显示密码",
  hidePassword: "隐藏密码",
  passwordMismatch: "两次输入的密码不一致",
  requiredMark: "必填",
  submit: "注册成员账号",
  submitting: "注册中",
  failed: "注册失败",
  /** 注册态切回登录 */
  loginAction: "已有账号？去登录",
  joinPrompt: "没有邀请码？",
  joinAction: "去加入我们",
  backHome: "返回首页",
} as const;

/** T-P0-2 账号菜单：挂在成员 / 管理侧栏足部。T-P1-4 增加双角色壳层切换。 */
export const accountMenuCopy = {
  /** `displayName` 为空时的降级展示名 */
  fallbackName: "成员",
  /** 触发按钮无障碍名称 */
  menuLabel: "账号菜单",
  /** 头像无障碍名（用户名已在文本里，头像用首字符生成） */
  avatarLabel: "账号头像",
  /** 角色标签：账号栏在用户名下方显示当前身份 */
  roleLabels: {
    MEMBER: "成员",
    ADMIN: "管理员",
  } as Record<string, string>,
  changePassword: "修改密码",
  /** 双角色：从管理壳切到成员工作台 */
  switchToMember: "切换至成员工作台",
  /** 双角色：从成员壳切到管理后台 */
  switchToAdmin: "切换至管理后台",
  logout: "退出登录",
  loggingOut: "退出中…",
} as const;
