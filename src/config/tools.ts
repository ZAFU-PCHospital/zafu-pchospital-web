/**
 * 工具索引页数据
 *
 * /tools 页改造后承载「实用工具 · 网址导航」：
 * - 顶部是技术文档知识库入口（横幅卡 + 文档清单读数）
 * - 下方是按分类组织的常用网址目录（搜索 + 分类筛选 + 卡片网格）
 *
 * 外链统一走官方站点，新增条目只改这里。
 */

export type ToolItem = {
  /** 工具名 */
  name: string;
  /** 一句用途说明 */
  description: string;
  /** 官方地址（外链，新窗口打开） */
  href: string;
  /** 额外检索词（别名 / 简称 / 常见关键词） */
  keywords?: readonly string[];
};

export type ToolCategory = {
  /** 分类 id，用于筛选 */
  id: string;
  /** 中文分类名 */
  label: string;
  /** 英文标签（卡片网格分组头右侧的等宽小字） */
  labelEn: string;
  /** 分类的额外检索词 */
  keywords?: readonly string[];
  tools: readonly ToolItem[];
};

/**
 * 分类顺序即页面渲染顺序。
 * 分类：系统装机 / 驱动下载 / 压缩解压 / 学校官网 / 游戏娱乐 / 网络与安全。
 */
export const toolCategories: readonly ToolCategory[] = [
  {
    id: "system",
    label: "系统与装机",
    labelEn: "System",
    tools: [
      {
        name: "图吧工具箱",
        description: "硬件检测与装机工具合集",
        href: "https://www.tbtool.cn/",
        keywords: ["tbtool", "硬件检测"],
      },
      {
        name: "微软官方 ISO",
        description: "Windows 官方镜像下载",
        href: "https://www.microsoft.com/zh-cn/software-download/windows11",
        keywords: ["windows", "iso", "系统镜像"],
      },
      {
        name: "Rufus",
        description: "U 盘启动盘制作工具",
        href: "https://rufus.ie/zh/",
        keywords: ["u盘", "启动盘"],
      },
      {
        name: "微 PE 工具箱",
        description: "纯净的 WinPE 维护系统",
        href: "https://www.wepe.com.cn/",
        keywords: ["pe", "winpe"],
      },
      {
        name: "Ventoy",
        description: "多系统启动 U 盘制作",
        href: "https://www.ventoy.net/cn/",
        keywords: ["多启动", "u盘"],
      },
      {
        name: "MSDN 我告诉你",
        description: "原版系统镜像下载站",
        href: "https://msdn.itellyou.cn/",
        keywords: ["原版", "iso"],
      },
      {
        name: "IT 天空",
        description: "万能驱动与装机工具",
        href: "https://www.itsk.com/",
        keywords: ["itsk", "万能驱动"],
      },
      {
        name: "Dism++",
        description: "系统精简与维护工具",
        href: "https://github.com/Chuyu-Team/Dism-Multi-language",
        keywords: ["dism", "精简"],
      },
    ],
  },
  {
    id: "driver",
    label: "驱动下载",
    labelEn: "Drivers",
    tools: [
      {
        name: "NVIDIA 显卡驱动",
        description: "英伟达 GeForce 驱动下载",
        href: "https://www.nvidia.cn/geforce/drivers/",
        keywords: ["n卡", "geforce"],
      },
      {
        name: "AMD 显卡驱动",
        description: "AMD 显卡驱动与软件",
        href: "https://www.amd.com/zh-cn/support",
        keywords: ["a卡", "radeon"],
      },
      {
        name: "Intel 驱动中心",
        description: "英特尔核显与驱动",
        href: "https://www.intel.cn/content/www/cn/zh/support/intel-driver-support-assistant.html",
        keywords: ["i卡", "核显"],
      },
      {
        name: "联想官网驱动",
        description: "联想笔记本驱动下载",
        href: "https://support.lenovo.com.cn/",
        keywords: ["笔记本"],
      },
      {
        name: "华硕官网驱动",
        description: "华硕笔记本驱动下载",
        href: "https://www.asus.com.cn/support/",
        keywords: ["笔记本"],
      },
      {
        name: "戴尔官网驱动",
        description: "戴尔笔记本驱动下载",
        href: "https://www.dell.com/support/home/zh-cn",
        keywords: ["笔记本"],
      },
      {
        name: "惠普官网驱动",
        description: "惠普笔记本驱动下载",
        href: "https://support.hp.com/cn-zh/drivers",
        keywords: ["笔记本"],
      },
    ],
  },
  {
    id: "archive",
    label: "压缩与解压",
    labelEn: "Archive",
    tools: [
      {
        name: "7-Zip 官方",
        description: "免费开源的压缩软件",
        href: "https://www.7-zip.org/",
        keywords: ["7z"],
      },
      {
        name: "Bandizip",
        description: "轻量美观的解压软件",
        href: "https://www.bandisoft.com/bandizip/",
        keywords: ["bandi"],
      },
      {
        name: "WinRAR 中文版",
        description: "经典压缩软件官方站",
        href: "https://www.winrar.com.cn/",
        keywords: ["rar"],
      },
      {
        name: "PeaZip",
        description: "开源多格式压缩工具",
        href: "https://peazip.github.io/",
        keywords: ["pea"],
      },
    ],
  },
  {
    id: "school",
    label: "学校官网",
    labelEn: "Campus",
    keywords: ["校园", "学校"],
    tools: [
      {
        name: "浙江农林大学官网",
        description: "学校主页与通知公告",
        href: "https://www.zafu.edu.cn/",
      },
      {
        name: "教务系统",
        description: "选课、成绩与教学安排",
        href: "https://jw.zafu.edu.cn/",
        keywords: ["选课", "成绩"],
      },
      {
        name: "校园网自助服务",
        description: "自助下线设备（需校园网）",
        href: "https://zfw.zafu.edu.cn/home",
        keywords: ["mac auth", "下线", "校园网"],
      },
      {
        name: "图书馆",
        description: "馆藏查询与数字资源",
        href: "https://lib.zafu.edu.cn/",
        keywords: ["馆藏", "文献"],
      },
    ],
  },
  {
    id: "game",
    label: "游戏娱乐",
    labelEn: "Gaming",
    tools: [
      {
        name: "Steam 官网",
        description: "全球最大游戏平台",
        href: "https://store.steampowered.com/",
      },
      {
        name: "Epic Games",
        description: "每周免费游戏",
        href: "https://store.epicgames.com/zh-CN/",
      },
      {
        name: "WeGame",
        description: "腾讯游戏平台",
        href: "https://www.wegame.com.cn/",
      },
      {
        name: "网易暴雪",
        description: "暴雪游戏国服",
        href: "https://www.blizzardgames.cn/",
      },
    ],
  },
  {
    id: "network",
    label: "网络与安全",
    labelEn: "Network",
    tools: [
      {
        name: "Speedtest 测速",
        description: "网络速度测试",
        href: "https://www.speedtest.net/zh-Hans",
      },
      {
        name: "火绒安全",
        description: "轻量免费杀毒软件",
        href: "https://www.huorong.cn/",
        keywords: ["杀毒"],
      },
      {
        name: "腾讯电脑管家",
        description: "安全与清理工具",
        href: "https://guanjia.qq.com/",
        keywords: ["杀毒", "清理"],
      },
      {
        name: "VirtualBox",
        description: "免费虚拟机软件",
        href: "https://www.virtualbox.org/",
        keywords: ["虚拟机", "vm"],
      },
    ],
  },
] as const;

/** 工具总数（用于目录计数展示） */
export const toolCount = toolCategories.reduce((sum, cat) => sum + cat.tools.length, 0);

/** 「全部」筛选项 */
export const allCategoryId = "all" as const;
