/**
 * /join 页面内容
 *
 * 加入我们。页面主体是「新社员信息登记」：QQ 号 / 姓名 / 联系电话三项必填，
 * 提交完成后显示招新群二维码。
 *
 * 本阶段（第一阶段）不实现数据库、成员系统与后台（见 AGENTS.md 第 3 节），
 * 登记表只在前端完成校验与状态流转，**不上传任何内容**。
 * 因此页面上必须如实标注，不得让填写者以为信息已经送达社团。
 */

export type JoinItem = { title: string; description: string };

export const joinPage = {
  title: "加入我们",
  lead: "电脑医院长期面向全校招收新成员。不要求你一开始就会修电脑，但要求你愿意把它学会，并且愿意对别人的设备负责。确认这一点之后，填好下面的登记信息即可加入招新群。",
} as const;

/**
 * 页内分区编号
 *
 * 页头（PageHead）独占 03 / Join，页内四个内容区依次顺延 04 ~ 07，
 * 避免同一页面上出现两个 03（与 /about 的编号方式一致）。
 */
export const joinSections = {
  signup: { index: "04", label: "Signup", title: "新社员信息登记" },
  expect: { index: "05", label: "Expect", title: "我们希望你具备" },
  flow: { index: "06", label: "Flow", title: "加入流程" },
  notice: { index: "07", label: "Notice", title: "加入须知" },
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
 * 校验规则只有这一处，页面不再另写一套 JS 校验。
 */
export type JoinSignupField = {
  /** 提交字段名，与 MemberSignupInput 的键一一对应 */
  name: "qq" | "realName" | "phone";
  label: string;
  placeholder: string;
  /** 字段下方的格式说明：原生校验提示很简略，格式必须在这里讲清楚 */
  hint: string;
  /** HTML pattern（整串匹配） */
  pattern: string;
  maxLength: number;
  type: "text" | "tel";
  inputMode: "numeric" | "text" | "tel";
  autoComplete: string;
};

export const joinSignupFields: readonly JoinSignupField[] = [
  {
    name: "qq",
    label: "QQ 号",
    placeholder: "例如 532502904",
    hint: "5–11 位数字。QQ 号是后续成员资格匹配的凭据，请填写常用号并确保没有填错。",
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
    hint: "与校园卡一致的姓名，用于成员建档。",
    pattern: "\\S{2,20}",
    maxLength: 20,
    type: "text",
    inputMode: "text",
    autoComplete: "name",
  },
  {
    name: "phone",
    label: "联系电话",
    placeholder: "例如 13800000000",
    hint: "11 位手机号，仅用于招新期间的联系。",
    pattern: "1[3-9]\\d{9}",
    maxLength: 11,
    type: "tel",
    inputMode: "tel",
    autoComplete: "tel",
  },
];

export const joinSignup = {
  /** 区块说明，放在标题旁 */
  note: "三项均为必填。填好提交，即可扫码加入招新群。",
  submitLabel: "提交登记",
  submittingLabel: "提交中",
  requiredMark: "必填",
  /** 提交按钮旁的说明 */
  privacy: "提交即表示同意社团在招新期间通过以上方式联系你。",

  /** 提交前，右侧说明栏 */
  asideTitle: "登记说明",
  asideRows: [
    { key: "用途", value: "仅用于招新联系与成员建档，不用于其他用途，也不对外公开。" },
    { key: "提交之后", value: "扫码加入招新群。招新通知、面谈与跟岗安排都在群内发布。" },
    { key: "数据去向", value: "本页目前是静态页面，填写内容不会上传到服务器。" },
  ],

  /** 提交完成后 */
  done: {
    mark: "提交完成",
    title: "最后一步：扫码加入招新群",
    note: "招新通知、面谈与跟岗安排都在招新群内发布。加群后请留意群公告。",
    pending: "填写内容暂不上传服务器，也不代表已经完成报名。",
    pendingBadge: "待接入数据库",
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
    title: "愿意投入时间",
    description:
      "值班、活动与培训都需要时间。具体的最低投入要求由社团在每学期招新时确认，本页暂不写死。",
  },
  {
    title: "不要求技术基础",
    description:
      "拆机、清灰、系统安装这些操作都会有人带。真正的要求是动手前先想清楚，拿不准就问，不要硬上。",
  },
  {
    title: "遵守《电医维修守则》",
    description:
      "一人一机、先确认再动手、维修后填记录表。守则既是给用户看的，也是成员每次动手前自己对的表。",
  },
  {
    title: "对用户的信息负责",
    description:
      "维修过程中会接触到用户的设备、数据与联系方式，仅用于完成本次维修，不得用于其他用途。",
  },
];

export const joinFlow: readonly JoinItem[] = [
  {
    title: "填写登记信息",
    description: "在页面顶部的登记表填写 QQ 号、姓名与联系电话，三项均为必填。",
  },
  {
    title: "扫码加入招新群",
    description: "提交后显示招新群二维码。招新通知、面谈与跟岗安排都在群内发布。",
  },
  {
    title: "面谈与了解",
    description: "简单聊一聊你的兴趣方向与时间安排，也让你了解社团实际在做什么。",
  },
  {
    title: "跟岗与培训",
    description: "跟着老成员看几次实际操作，熟悉流程与守则，再决定是否继续。",
  },
  {
    title: "成为正式成员",
    description: "通过后由管理员把 QQ 录入成员名单，完成绑定即可参与值班与活动。",
  },
];

export const joinNotice = {
  badge: "加入须知",
  title: "登记表尚未接入数据库",
  paragraphs: [
    "本页的登记表目前只在前端完成填写与校验：提交内容不会上传到任何服务器，也不代表已经完成报名。",
    "招新时间、报名截止、面谈与跟岗的具体安排，一律以招新群内发布的通知为准，请不要以本页内容作为最终依据。",
  ],
} as const;

/** 需要社团确认后再补写的字段 */
export const joinPendingFields: readonly string[] = [
  "本学期招新时间窗口",
  "登记信息的接收方式与截止时间",
  "面试与跟岗的具体安排",
  "成员最低值班时长要求",
];
