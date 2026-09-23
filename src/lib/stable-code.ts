import { createHash } from "node:crypto";

/**
 * 由中文/中英混排名称生成**稳定标识**（M6：技能标签与故障分类的 `code`）。
 *
 * 为什么要有这个函数：管理员加一个「散热清灰」标签时，不应该被迫先编一个英文 code ——
 * 那是系统的活儿，不是使用者的活儿。表单里不再出现该字段，改由服务端在这里生成。
 *
 * 规则（确定性：**同一个名称永远得到同一个标识**）：
 * 1. 名称全是 ASCII 字母数字与分隔符 → 折叠成大写下划线形式：`Windows Driver` → `WINDOWS_DRIVER`；
 * 2. 名称里含任何非 ASCII 字符（中文、全角标点等）→ 取名称的 sha256 前 8 位十六进制：
 *    `散热清灰` → `SK_3F9A2B1C`。
 *
 * 为什么不做「中文转拼音」：那需要一份两万字的汉字读音表。仓库里没有、也不该为一个
 * 标识字段引入新依赖；而只覆盖常见字的残缺拼音表更糟 —— 遇到表外字就会生成
 * 半拼音半随机的标识，比纯哈希更难解释。标识本身对使用者不可见（表单不填、列表不显示），
 * 可读性只影响直接查库的人，因此优先选「确定性 + 不撞车」而不是「勉强可读」。
 *
 * ⚠️ 分支 2 必须包含**整个名称**参与哈希。只取其中的 ASCII 片段会让
 * `CPU 主板` 与 `CPU 显卡` 生成同一个标识（都只剩 `CPU`），于是「新建一个名字完全不同的
 * 标签」会报「标识已存在」—— 那是最难排查的一类错误。
 */
export function stableCodeFromName(name: string, prefix: string): string {
  const trimmed = name.trim();
  const asciiSlug = trimmed
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  // 名称含非 ASCII 字符时不能只留 ASCII 片段（见上），改用名称哈希。
  const isPureAscii = /^[\x20-\x7E]+$/.test(trimmed);
  if (isPureAscii && /^[A-Z]/.test(asciiSlug) && asciiSlug.length >= 2 && asciiSlug.length <= 64) {
    return asciiSlug;
  }
  const digest = createHash("sha256").update(trimmed, "utf8").digest("hex");
  return `${prefix}_${digest.slice(0, 8).toUpperCase()}`;
}
