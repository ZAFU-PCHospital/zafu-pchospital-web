import { PrismaMariaDb } from "@prisma/adapter-mariadb";

import { PrismaClient } from "../src/generated/prisma/client";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("缺少环境变量：DATABASE_URL");

const url = new URL(databaseUrl);
const adapter = new PrismaMariaDb({
  host: url.hostname,
  port: url.port ? Number(url.port) : 3306,
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: url.pathname.replace(/^\//, ""),
  timezone: "Z",
  charset: "utf8mb4",
});
async function main(): Promise<void> {
  const prisma = new PrismaClient({ adapter });
  const now = new Date();
  try {
    await prisma.role.upsert({
      where: { code: "MEMBER" },
      update: { name: "成员" },
      create: {
        id: "00000000-0000-4000-8000-000000000001",
        code: "MEMBER",
        name: "成员",
        createdAt: now,
      },
    });
    const categories = [
      ["10000000-0000-4000-8000-000000000001", "COOLING_CLEANING", "散热 / 清灰"],
      ["10000000-0000-4000-8000-000000000002", "HARDWARE", "硬件故障"],
      ["10000000-0000-4000-8000-000000000003", "SYSTEM", "系统问题"],
      ["10000000-0000-4000-8000-000000000004", "SOFTWARE", "软件问题"],
      ["10000000-0000-4000-8000-000000000005", "DRIVER", "驱动问题"],
      ["10000000-0000-4000-8000-000000000006", "NETWORK", "网络问题"],
      ["10000000-0000-4000-8000-000000000007", "STORAGE", "磁盘 / 存储"],
      ["10000000-0000-4000-8000-000000000008", "PERIPHERAL", "外设问题"],
      ["10000000-0000-4000-8000-000000000009", "OTHER", "其他"],
      ["10000000-0000-4000-8000-000000000010", "OTHER_FAULT", "其他故障"],
    ] as const;
    for (const [index, [id, code, name]] of categories.entries()) {
      await prisma.repairCategory.upsert({
        where: { code },
        update: { name, sortOrder: index + 1 },
        create: { id, code, name, sortOrder: index + 1, createdAt: now },
      });
    }
    await prisma.role.upsert({
      where: { code: "ADMIN" },
      update: { name: "管理员" },
      create: {
        id: "00000000-0000-4000-8000-000000000002",
        code: "ADMIN",
        name: "管理员",
        createdAt: now,
      },
    });

    // M3 技能标签初始 Seed（任务书 §5.4）。
    // 与分类不同：这里**只补不存在的 code**，绝不覆盖管理员后续修改的名称、
    // 描述、排序或启用状态，因此 update 分支必须为空对象。
    const skills = [
      ["20000000-0000-4000-8000-000000000001", "WINDOWS", "Windows"],
      ["20000000-0000-4000-8000-000000000002", "HARDWARE", "硬件维修"],
      ["20000000-0000-4000-8000-000000000003", "NETWORK", "网络排障"],
      ["20000000-0000-4000-8000-000000000004", "LINUX", "Linux"],
      ["20000000-0000-4000-8000-000000000005", "LAPTOP_DISASSEMBLY", "笔记本拆装"],
      ["20000000-0000-4000-8000-000000000006", "SYSTEM_INSTALLATION", "系统安装"],
      ["20000000-0000-4000-8000-000000000007", "DRIVER", "驱动处理"],
      ["20000000-0000-4000-8000-000000000008", "STORAGE", "存储与数据迁移"],
    ] as const;
    for (const [index, [id, code, name]] of skills.entries()) {
      await prisma.skill.upsert({
        where: { code },
        update: {},
        create: { id, code, name, sortOrder: (index + 1) * 10, isActive: true, createdAt: now },
      });
    }

    // 工具导航初始 Seed：6 个分类 + 31 个网站，与 `src/config/tools.ts` 的兜底清单逐条对齐。
    // 与技能标签同样的规则：**只补不覆盖**，管理员在后台改过的名称、地址、描述、
    // 排序与启停状态都不会被重新 seed 冲掉（update 分支必须是空对象）。
    const toolCategories = [
      ["30000000-0000-4000-8000-000000000001", "SYSTEM", "系统与装机", "System"],
      ["30000000-0000-4000-8000-000000000002", "DRIVER", "驱动下载", "Drivers"],
      ["30000000-0000-4000-8000-000000000003", "ARCHIVE", "压缩与解压", "Archive"],
      ["30000000-0000-4000-8000-000000000004", "CAMPUS", "学校官网", "Campus"],
      ["30000000-0000-4000-8000-000000000005", "GAMING", "游戏娱乐", "Gaming"],
      ["30000000-0000-4000-8000-000000000006", "NETWORK", "网络与安全", "Network"],
    ] as const;
    for (const [id, code, name, labelEn] of toolCategories) {
      await prisma.$transaction(async (tx) => {
        const max = await tx.toolCategory.aggregate({
          where: { deletedAt: null },
          _max: { sortOrder: true },
        });
        await tx.toolCategory.upsert({
          where: { code },
          update: {},
          create: {
            id,
            code,
            name,
            labelEn,
            sortOrder: (max._max.sortOrder ?? -1) + 1,
            createdAt: now,
          },
        });
      });
    }
    const toolSites: readonly (readonly [string, string, string, string, string])[] = [
      [
        "40000000-0000-4000-8000-000000000001",
        "SYSTEM",
        "图吧工具箱",
        "https://www.tbtool.cn/",
        "硬件检测与装机工具合集",
      ],
      [
        "40000000-0000-4000-8000-000000000002",
        "SYSTEM",
        "微软官方 ISO",
        "https://www.microsoft.com/zh-cn/software-download/windows11",
        "Windows 官方镜像下载",
      ],
      [
        "40000000-0000-4000-8000-000000000003",
        "SYSTEM",
        "Rufus",
        "https://rufus.ie/zh/",
        "U 盘启动盘制作工具",
      ],
      [
        "40000000-0000-4000-8000-000000000004",
        "SYSTEM",
        "微 PE 工具箱",
        "https://www.wepe.com.cn/",
        "纯净的 WinPE 维护系统",
      ],
      [
        "40000000-0000-4000-8000-000000000005",
        "SYSTEM",
        "Ventoy",
        "https://www.ventoy.net/cn/",
        "多系统启动 U 盘制作",
      ],
      [
        "40000000-0000-4000-8000-000000000006",
        "SYSTEM",
        "MSDN 我告诉你",
        "https://msdn.itellyou.cn/",
        "原版系统镜像下载站",
      ],
      [
        "40000000-0000-4000-8000-000000000007",
        "SYSTEM",
        "IT 天空",
        "https://www.itsk.com/",
        "万能驱动与装机工具",
      ],
      [
        "40000000-0000-4000-8000-000000000008",
        "SYSTEM",
        "Dism++",
        "https://github.com/Chuyu-Team/Dism-Multi-language",
        "系统精简与维护工具",
      ],
      [
        "40000000-0000-4000-8000-000000000009",
        "DRIVER",
        "NVIDIA 显卡驱动",
        "https://www.nvidia.cn/geforce/drivers/",
        "英伟达 GeForce 驱动下载",
      ],
      [
        "40000000-0000-4000-8000-000000000010",
        "DRIVER",
        "AMD 显卡驱动",
        "https://www.amd.com/zh-cn/support",
        "AMD 显卡驱动与软件",
      ],
      [
        "40000000-0000-4000-8000-000000000011",
        "DRIVER",
        "Intel 驱动中心",
        "https://www.intel.cn/content/www/cn/zh/support/intel-driver-support-assistant.html",
        "英特尔核显与驱动",
      ],
      [
        "40000000-0000-4000-8000-000000000012",
        "DRIVER",
        "联想官网驱动",
        "https://support.lenovo.com.cn/",
        "联想笔记本驱动下载",
      ],
      [
        "40000000-0000-4000-8000-000000000029",
        "DRIVER",
        "华硕官网驱动",
        "https://www.asus.com.cn/support/",
        "华硕笔记本驱动下载",
      ],
      [
        "40000000-0000-4000-8000-000000000030",
        "DRIVER",
        "戴尔官网驱动",
        "https://www.dell.com/support/home/zh-cn",
        "戴尔笔记本驱动下载",
      ],
      [
        "40000000-0000-4000-8000-000000000031",
        "DRIVER",
        "惠普官网驱动",
        "https://support.hp.com/cn-zh/drivers",
        "惠普笔记本驱动下载",
      ],
      [
        "40000000-0000-4000-8000-000000000013",
        "ARCHIVE",
        "7-Zip 官方",
        "https://www.7-zip.org/",
        "免费开源的压缩软件",
      ],
      [
        "40000000-0000-4000-8000-000000000014",
        "ARCHIVE",
        "Bandizip",
        "https://www.bandisoft.com/bandizip/",
        "轻量美观的解压软件",
      ],
      [
        "40000000-0000-4000-8000-000000000015",
        "ARCHIVE",
        "WinRAR 中文版",
        "https://www.winrar.com.cn/",
        "经典压缩软件官方站",
      ],
      [
        "40000000-0000-4000-8000-000000000016",
        "ARCHIVE",
        "PeaZip",
        "https://peazip.github.io/",
        "开源多格式压缩工具",
      ],
      [
        "40000000-0000-4000-8000-000000000017",
        "CAMPUS",
        "浙江农林大学官网",
        "https://www.zafu.edu.cn/",
        "学校主页与通知公告",
      ],
      [
        "40000000-0000-4000-8000-000000000018",
        "CAMPUS",
        "教务系统",
        "https://jw.zafu.edu.cn/",
        "选课、成绩与教学安排",
      ],
      [
        "40000000-0000-4000-8000-000000000019",
        "CAMPUS",
        "校园网自助服务",
        "https://zfw.zafu.edu.cn/home",
        "自助下线设备（需校园网）",
      ],
      [
        "40000000-0000-4000-8000-000000000020",
        "CAMPUS",
        "图书馆",
        "https://lib.zafu.edu.cn/",
        "馆藏查询与数字资源",
      ],
      [
        "40000000-0000-4000-8000-000000000021",
        "GAMING",
        "Steam 官网",
        "https://store.steampowered.com/",
        "全球最大游戏平台",
      ],
      [
        "40000000-0000-4000-8000-000000000022",
        "GAMING",
        "Epic Games",
        "https://store.epicgames.com/zh-CN/",
        "每周免费游戏",
      ],
      [
        "40000000-0000-4000-8000-000000000023",
        "GAMING",
        "WeGame",
        "https://www.wegame.com.cn/",
        "腾讯游戏平台",
      ],
      [
        "40000000-0000-4000-8000-000000000024",
        "GAMING",
        "网易暴雪",
        "https://www.blizzardgames.cn/",
        "暴雪游戏国服",
      ],
      [
        "40000000-0000-4000-8000-000000000025",
        "NETWORK",
        "Speedtest 测速",
        "https://www.speedtest.net/zh-Hans",
        "网络速度测试",
      ],
      [
        "40000000-0000-4000-8000-000000000026",
        "NETWORK",
        "火绒安全",
        "https://www.huorong.cn/",
        "轻量免费杀毒软件",
      ],
      [
        "40000000-0000-4000-8000-000000000027",
        "NETWORK",
        "腾讯电脑管家",
        "https://guanjia.qq.com/",
        "安全与清理工具",
      ],
      [
        "40000000-0000-4000-8000-000000000028",
        "NETWORK",
        "VirtualBox",
        "https://www.virtualbox.org/",
        "免费虚拟机软件",
      ],
    ];
    const categoryIdByCode = new Map(
      (
        await prisma.toolCategory.findMany({
          where: { deletedAt: null },
          select: { id: true, code: true },
        })
      ).map((row) => [row.code, row.id]),
    );
    for (const [id, categoryCode, name, url, description] of toolSites) {
      const categoryId = categoryIdByCode.get(categoryCode);
      if (!categoryId) continue;
      await prisma.$transaction(
        async (tx) => {
          const categories = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM tool_categories
          WHERE id = ${categoryId} AND deleted_at IS NULL FOR UPDATE`;
          if (categories.length === 0) return;
          const existing = await tx.toolSite.findFirst({
            where: { OR: [{ id }, { categoryId, url, deletedAt: null }] },
            select: { id: true },
          });
          if (existing) return;
          const max = await tx.toolSite.aggregate({
            where: { categoryId, deletedAt: null },
            _max: { sortOrder: true },
          });
          await tx.toolSite.create({
            data: {
              id,
              categoryId,
              name,
              url,
              description,
              sortOrder: (max._max.sortOrder ?? -1) + 1,
              createdAt: now,
            },
          });
        },
        { isolationLevel: "ReadCommitted" },
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main();
