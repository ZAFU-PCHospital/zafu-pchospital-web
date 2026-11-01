/**
 * 首页内容数据
 *
 * 首页各区块的文案与条目集中在这里，组件只负责渲染。
 * 后续其他成员扩充服务项 / 流程步骤时，改这个文件即可。
 */

export type Service = {
  name: string;
  description: string;
};

export type Principle = { title: string; description: string };
export type ProcessStep = { title: string; description: string };

export const heroContent = {
  tag: "志愿技术服务 · 面向全校师生",
  logoAlt: "浙江农林大学电脑医院标志",
  titleMain: "电脑医院",
  titleSub: "浙江农林大学",
  wordmark: "ZAFU PC HOSPITAL",
  meta: "电脑医院 · 志愿技术服务 · 浙江农林大学",
  glyph: "PC HOSPITAL",
  scrollLabel: "向下滚动",
  lead: "浙江农林大学电脑医院成立于2003年，是一个由人工智能学院学生主导、跨学科学生参与的综合志愿服务组织。我们构建了「专业维修 + 数字科普 + AI 赋能」的三维服务体系，提供散热模组清理、硬件维修、系统与驱动、蓝屏与磁盘排查等专业维修服务。",
} as const;

export type HeroAction = {
  label: string;
  /**
   * 目标地址。留空表示对应页面尚未就绪，按钮渲染为原生 button、点击不跳转；
   * 页面完成后把地址填进来即可生效，组件不需要改动。
   */
  href: string;
};

/**
 * 首页 Hero 的行动按钮（UX R3 / N3 · 口径 C1）
 *
 * 主按钮「报名活动」→ `/repair-activities`；次要「维修说明」→ 首页流程锚点 `/#process`。
 * 文档入口仍走公开导航 05，不占 Hero 次位。呈现主次在 Hero.tsx。
 */
export const heroActions: Record<"repair" | "docs", HeroAction> = {
  repair: { label: "报名活动", href: "/repair-activities" },
  docs: { label: "维修说明", href: "/#process" },
};

/**
 * 首页近场活动预览（UX R3 / R7，issue #317）
 *
 * 优先展示 1–3 场未结束活动；没有未结束活动时展示最近 3 场已结束活动，
 * 两者都没有时整块不渲染。
 */
export const homeActivityPreview = {
  index: "01",
  label: "Activities",
  title: "近期维修活动",
  viewAll: "查看全部",
  viewAllHref: "/repair-activities",
  capacity: "名额 {registered} / {capacity}",
  remainingShort: "剩余 {count}",
  activityAt: "活动时间",
  endedHint: "活动已结束",
  detailCta: "查看详情",
  loadFailedSilent: true,
} as const;

export const homePublicAnalytics = {
  title: "维修服务记录",
  label: "Service Records",
  statsTitle: "维修统计",
  total: "累计服务设备",
  /** 学年口径：`{academicYear}` 由服务端下发的同一段区间替换，如「2026–2027 学年维修」。 */
  year: "{academicYear}维修",
  duration: "累计维修时长",
  countUnit: "台",
  durationUnit: "小时",
  rankingTitle: "{academicYear}维修排行",
  rankingTag: "TOP 3",
  rankColumn: "排名",
  memberColumn: "成员",
  countColumn: "维修次数",
  rankingUnit: "次",
  rankingEmpty: "本学年暂无上榜记录。",
  rankLabel: "第 {rank} 名",
  readoutTitle: "维修服务记录",
  readoutTag: "REPAIR",
  note: "仅统计已审核通过、未删除的维修记录；每条维修记录按一次计入总量。",
  rankingNote: "按{academicYear}审核通过的维修次数排序。",
} as const;

export const aboutContent = {
  title: "关于电脑医院",
  lead: "电脑医院是浙江农林大学的志愿性学生技术社团。我们做的事很具体：把出问题的电脑修好，把说不清的网络问题查清，再把攒下来的经验整理成任何人都能查的文档。",
  muted:
    "第一次来不需要准备什么。把设备带上，把问题的现象尽量说清楚就够了。我们会先尝试复现问题，再决定怎么动手。",
} as const;

export const tickerItems: readonly string[] = [
  "ZAFU PC HOSPITAL",
  "志愿技术服务",
  "CAMPUS NETWORK",
  "校园网认证",
  "HARDWARE",
  "拆机，清灰，硅脂",
  "SYSTEM & DRIVER",
  "系统与驱动",
  "DOCUMENTED",
  "全程留档",
];

export const principles: readonly Principle[] = [
  {
    title: "志愿性质，不收费",
    description:
      "电脑社团由学生志愿运营，原则上不收取任何费用。若有购买额外维修用品或更换硬件，我们会提前告知客户并建议客户自行购买。当然，我们也欢迎客户对我们的友情赞助，我们会将该费用作为社团活动经费的一部分并赠送锦旗表达感谢。",
  },
  {
    title: "先确认，再动手",
    description:
      "涉及可能影响保修的操作（例如拆卸散热模块），会先向你确认保修信息。存在风险的操作，先说明清楚并征得同意。",
  },
  {
    title: "一人一机，全程留档",
    description:
      "每台机器由一人负责到底，非紧急情况不中途转交，避免漏掉螺丝、排线或无线网卡。处理完填写维修记录表。",
  },
];

export const services: readonly Service[] = [
  {
    name: "电脑散热模组深度清理",
    description: "拆机除尘、更换硅脂、风扇与散热模组复装等。",
  },
  {
    name: "硬件故障排查",
    description: "不开机、充不上电、屏幕与排线问题、内存硬盘的检测替换等。",
  },
  {
    name: "系统与软件问题处理",
    description: "系统安装与配置、驱动与软件故障排查、蓝屏及磁盘异常等。",
  },
  {
    name: "网络问题排查",
    description: "校园网认证失败、认证后无法正常上网、路由器接入、多设备下线与 MAC Auth 配置等。",
  },
  {
    name: "计算机基础答疑",
    description: "从最基础的使用与维护问题讲起，包括日常保养、备份习惯和安全安装软件等。",
  },
];

export const processSteps: readonly ProcessStep[] = [
  {
    title: "现象说明",
    description: "请描述故障：发生时间、触发操作，以及重启后故障是否重现。",
  },
  {
    title: "现场复现",
    description: "我们优先现场复现故障，再定位问题。会参考你的描述，但不会仅凭口述判定故障原因。",
  },
  {
    title: "风险确认",
    description: "若操作涉及保修或存在风险，我们提前告知潜在影响，征得你的同意后再操作。",
  },
  {
    title: "维修操作",
    description:
      "维修全程一对一对接，非紧急情况不更换维修人员。拆卸的螺丝、排线等部件，均会做好位置记录，装回原处。",
  },
  {
    title: "记录归档",
    description:
      "为了保障服务质量，维修完成请填写维修档案，留存你的联系方式。后续如果有任何问题，方便联系与溯源。",
  },
];

export const processNotice = {
  badge: "客户须知",
  title: "电脑医院是志愿性质的服务类社团",
  paragraphs: [
    "遇到困难的时候我们会尽力解决。对于存在风险或不在能力范围内的操作，我们会在动手前明确告知，并在你同意后再进行维修。",
    "志愿维修不收取费用，因设备自身状况或既有故障导致的损失，我们不承担责任；确需更换配件时，会提前告知并建议自行购买。",
  ],
} as const;

export const docsTeaser = {
  title: "全套维修与排障文档，开源可查",
  lead: "文档仓库 ZAFU-PCHospital-Doc 收录了校园网认证、硬件保养、系统与驱动等条目。已就绪内容可在站内直接阅读，源文件保持公开，也欢迎提交勘误与补充。",
} as const;
