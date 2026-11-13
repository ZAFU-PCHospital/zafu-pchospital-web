/**
 * /join 页面内容
 *
 * 加入我们。页面主体是「新社员信息登记」：QQ 号 / 姓名 / 联系电话 / 邮箱 / 学号 / 班级六项必填，
 * 提交完成后显示招新群二维码。
 *
 * 登记表通过统一 API 写入招募申请；重复提交返回原报名回执。
 */

import {
  CLASS_NAME_MAX_LENGTH,
  EMAIL_MAX_LENGTH,
  PERSON_NAME_MAX_LENGTH,
  PERSON_NAME_MIN_LENGTH,
  STUDENT_ID_MAX_LENGTH,
} from "@/lib/security/normalization";

export type JoinItem = { title: string; description: string };

export const joinPage = {
  title: "加入我们",
  lead: "电脑医院长期面向全校招收新成员。不要求你一开始就会修电脑，但要求你愿意把它学会，并且愿意对别人的设备负责。确认这一点之后，填好下面的登记信息即可加入招新群",
} as const;

/**
 * 页内分区编号
 *
 * 页头（PageHead）独占 04 / Join，页内四个内容区依次顺延 05 ~ 08，
 * 避免同一页面上出现两个 04（与 /about 的编号方式一致；UX R3 / N1）。
 */
export const joinSections = {
  signup: { index: "05", label: "Signup", title: "新社员信息登记" },
  expect: { index: "06", label: "Expect", title: "我们希望你具备" },
  flow: { index: "07", label: "Flow", title: "加入流程" },
  notice: { index: "08", label: "Notice", title: "加入须知" },
} as const;

/* ------------------------------------------------------- 新社员信息登记 */

/**
 * 登记表字段
 *
 * 这一份定义同时承担三个职责，不要在各处重复散写：
 *   1. 页面上的标签、占位符与格式说明（文案）；
 *   2. HTML 原生约束校验（required / pattern / maxLength / inputMode）；
 *   3. 提交给后端的字段名 —— 与 src/lib/member-signup.ts 的 MemberSignupInput 一致。
 *
 * pattern 使用 HTML pattern 的整串匹配语义（不需要 ^ $）。
 * 邮箱规范化 / 格式与长度复用 normalization.ts；其余原生约束由此配置，服务端仍权威校验。
 */
export type JoinSignupField = {
  /** 提交字段名，与 MemberSignupInput 的键一一对应 */
  name: "qq" | "realName" | "phone" | "email" | "studentId" | "className";
  label: string;
  placeholder: string;
  /** 字段下方的格式说明：原生校验提示很简略，格式必须在这里讲清楚 */
  hint: string;
  /** HTML pattern（整串匹配）。自由文本字段不设 pattern：粘贴带空格是常见输入，交给 trim 处理 */
  pattern?: string;
  /** HTML minLength。自由文本字段（姓名等）用它表达「trim 后至少几个字符」，与常量同源 */
  minLength?: number;
  maxLength: number;
  type: "text" | "tel" | "email";
  inputMode: "numeric" | "text" | "tel" | "email";
  autoComplete: string;
};

export const joinSignupFields: readonly JoinSignupField[] = [
  {
    name: "qq",
    label: "QQ 号",
    placeholder: "例如 532502904",
    hint: "5–11 位数字，用于账号登录",
    pattern: "\\d{5,11}",
    maxLength: 11,
    type: "text",
    inputMode: "numeric",
    autoComplete: "off",
  },
  {
    name: "realName",
    label: "姓名",
    placeholder: "请填写真实姓名",
    // 姓名：只去首尾空白，trim 后 2–64 字符，内部字符与空格保留；
    // 不设整串 pattern（此前是 \S{2,20}，会连内部空格一起拒掉、且卡在 20 字符）。
    hint: `真实姓名，${PERSON_NAME_MIN_LENGTH}–${PERSON_NAME_MAX_LENGTH} 个字符`,
    minLength: PERSON_NAME_MIN_LENGTH,
    maxLength: PERSON_NAME_MAX_LENGTH,
    type: "text",
    inputMode: "text",
    autoComplete: "name",
  },
  {
    name: "phone",
    label: "联系电话",
    placeholder: "例如 13800000000",
    hint: "11 位手机号，仅用于招新期间的联系",
    pattern: "1[3-9]\\d{9}",
    maxLength: 11,
    type: "tel",
    inputMode: "tel",
    autoComplete: "tel",
  },
  {
    name: "email",
    label: "邮箱",
    placeholder: "例如 name@example.com",
    hint: "用于接收面试结果与账号通知",
    maxLength: EMAIL_MAX_LENGTH,
    type: "email",
    inputMode: "email",
    autoComplete: "email",
  },
  {
    name: "studentId",
    label: "学号",
    placeholder: "例如 202310120101",
    hint: `与学籍一致，保留前导零，最多 ${STUDENT_ID_MAX_LENGTH} 个字符`,
    maxLength: STUDENT_ID_MAX_LENGTH,
    type: "text",
    inputMode: "text",
    autoComplete: "off",
  },
  {
    name: "className",
    label: "班级",
    placeholder: "例如 计算机 233",
    hint: `最多 ${CLASS_NAME_MAX_LENGTH} 个字符`,
    maxLength: CLASS_NAME_MAX_LENGTH,
    type: "text",
    inputMode: "text",
    autoComplete: "off",
  },
];

export const joinSignup = {
  /** 区块说明，放在标题旁 */
  note: "提交后扫码加入招新群",
  submitLabel: "提交登记",
  /** 与 submitLabel 同为 4 字，避免提交瞬间按钮变窄把旁边的说明顶动 */
  submittingLabel: "提交中…",
  requiredMark: "必填",
  /** 提交按钮旁的说明（常驻一行，下面两句都在这一行里原地替换） */
  privacy: "提交即同意社团使用登记信息进行招新联系与成员建档，邮箱用于报名与账号通知",
  /** 按钮还没就绪（脚本未接上）时的说明，只在等得久时出现 */
  loadingNote: "正在加载表单，稍候即可提交",
  /** 提交期间的说明：与 privacy 长度相当，换文案不会让页面长高 */
  submittingNote: "正在提交，请不要关闭或刷新页面",

  /** 提交前，右侧说明栏 */
  asideTitle: "登记说明",
  asideRows: [
    { key: "用途", value: "用于招新联系与成员建档；邮箱用于报名与账号通知，不对外公开" },
    { key: "提交之后", value: "扫码加入招新群。招新通知与面试安排都在群内发布" },
    { key: "数据去向", value: "登记信息会写入招募系统，并仅向获授权的管理员开放" },
  ],

  /** 提交完成后 */
  done: {
    mark: "提交完成",
    title: "最后一步：扫码加入招新群",
    note: "招新通知与面试安排都在招新群内发布。加群后请留意群公告",
    ticketLabel: "报名回执",
    duplicate: "你已登记，无需重复提交",
    reset: "重新填写",
  },
} as const;

/**
 * 招新群二维码
 *
 * 提交登记后显示。处理方式与 /about 的 contactQr 一致（见 design-system 第 9.8 节）：
 * 同一个码准备深浅两版，两个 `<img>` 都参与服务端渲染，由 `html[data-theme]` 决定显示哪张。
 * - `srcLight` 浅底原色版，用于暖白纸面的正常模式
 * - `src`      深底黄码版，图片自带与深色主题同色的深底
 *
 * 两版取自同一张 1284×2280 截图的同一区块（x 120-1163 / y 360-1682），
 * 裁切后尺寸完全一致（1044×1323），切换主题不会引起任何布局跳动。
 * 卡片只负责描边与图注（见第 4.2 节）。
 */
export const joinSignupQr = {
  src: "/qq-admission-group-qrcode-accent.png",
  srcLight: "/qq-admission-group-qrcode-light.jpg",
  alt: "浙江农林大学电脑医院招新群二维码",
  caption: "电脑医院招新群",
  hint: "扫码加入",
} as const;

/* ------------------------------------------------------------ 招新说明 */

export const joinExpectations: readonly JoinItem[] = [
  {
    title: "技术基础",
    description:
      "我们会优先录取对维修电脑有经验者，但也同样欢迎对学习电脑维修知识有兴趣的小白。无需担心存在技术壁垒，资深成员会从基本操作开始带你进行手把手实操，以实践锻炼手法，积累经验",
  },
  {
    title: "保持热情",
    description:
      "对学习新知识保持热情——这是我们对新人唯一的要求。不懂的问题先想到自学，无法解决的再寻求帮助，永远怀有探索精神，这也同时是电脑医院的立社之本",
  },
  {
    title: "对用户负责",
    description:
      "电脑维修碰到疑难杂症是家常便饭，但这不应该成为电脑医院成员中途退缩的理由。当你决定接下一位客户的委托，无论免费与否，对于你来说都是一份理应坚持到底的责任",
  },
];

export const joinFlow: readonly JoinItem[] = [
  {
    title: "填写登记信息",
    description: "在页面顶部的登记表填写 QQ 号、姓名、联系电话、邮箱、学号与班级，六项均为必填",
  },
  {
    title: "扫码加入招新群",
    description: "提交后显示招新群二维码。招新通知、面试与跟岗安排都在群内发布",
  },
  {
    title: "面试与了解",
    description: "简单聊一聊你的兴趣方向与时间安排，也让你了解社团实际在做什么",
  },
  {
    title: "跟岗与培训",
    description: "跟着老成员看几次实际操作，熟悉流程与守则，再决定是否继续",
  },
  {
    title: "成为正式成员",
    description: "通过后由管理员把 QQ 录入成员名单，完成绑定即可参与值班与活动",
  },
];

export const joinNotice = {
  badge: "加入须知",
  title: "提交前请确认联系方式准确",
  paragraphs: [
    "登记信息提交后会进入招募系统；相同招募批次内重复使用 QQ 或手机号，会返回已有报名回执",
    "招新时间、报名截止、面谈与跟岗的具体安排，一律以招新群内发布的通知为准，请不要以本页内容作为最终依据",
  ],
} as const;

/** 招新须知：四项已由社团确认的内容（issue #382） */
export const joinNoticeItems: readonly JoinItem[] = [
  {
    title: "招新时间窗口",
    description: "每学期于「百团大战」前后开展招新，具体时间请加群获取。",
  },
  {
    title: "报名与结果通知",
    description: "提交登记信息后扫码加入招新群；后续会安排一次简单面试，结果当面公布。",
  },
  {
    title: "面试与培训安排",
    description:
      "每学期招新面试结束后会安排 1–2 次集体培训，欢迎踊跃参加；参加后即可参与维修活动。",
  },
  {
    title: "值班时长要求",
    description: "没有最低值班时长要求；新人只需确保参加集体培训，后续维修活动可自愿参加。",
  },
];
