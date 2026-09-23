"use client";

import { MEMBER_SKILL_LIMIT, type SkillView } from "@/types/contracts";

/**
 * 标签选择器（M6 第三轮验收：参考 B 站投稿页的标签行）。
 *
 * 这个组件由 M3 的 `MemberSkillPicker` 提升而来 —— 管理端的成员详情也要选技能标签，
 * 两处各写一套选择器就是「同一个控件两份实现」，之后的改动必然只改一边。
 * 因此它放在 `components/ui/`，管理端与成员自助共用，差异全部通过 props（文案、上限、
 * 是否禁用）表达，不靠复制。
 *
 * 三处刻意的设计，都是针对原先「一列复选框 / 一排药丸按钮」的问题：
 *
 * 1. **已选与候选分开**。原设计里「已选」只体现为一个勾或高亮，一屏扫一遍才知道选了什么；
 *    这里已选的标签集中在上方的「输入框」里，点 × 直接去掉。
 * 2. **上限可见**。「还能选几个」是决策信息，原先只在字段说明里；现在实时显示剩余额度，
 *    到上限后未选中的候选自动禁用（而不是静默忽略点击）。
 * 3. **候选一行铺开**，不需要「先滚动找，再点复选框」。
 *
 * 已停用的标签如果有成员持有，必须仍然出现（否则它继续占用上限却没有取消入口），
 * 带一个「已停用」标记；调用方用 `mergeSkillOptions()` 把这类标签补进 `options`。
 */
export type TagPickerLabels = {
  empty: string;
  /** `{count}` 替换成剩余可选数量。 */
  remaining: string;
  /** `{name}` 替换成标签名，用于单个标签移除按钮的无障碍名称。 */
  remove: string;
  inactive: string;
  /** `{limit}` 替换成上限；只在达到上限时显示。 */
  limitReached: string;
};

export function TagPicker({
  options,
  selectedIds,
  onChange,
  labels,
  disabled = false,
  limit = MEMBER_SKILL_LIMIT,
}: {
  options: readonly SkillView[];
  selectedIds: readonly string[];
  onChange: (next: string[]) => void;
  labels: TagPickerLabels;
  disabled?: boolean;
  limit?: number;
}) {
  const selected = new Set(selectedIds);
  const remaining = Math.max(0, limit - selected.size);
  const atLimit = remaining === 0;
  const selectedTags = options.filter((option) => selected.has(option.id));

  function toggle(skillId: string) {
    if (disabled) return;
    if (selected.has(skillId)) {
      onChange(selectedIds.filter((id) => id !== skillId));
      return;
    }
    if (atLimit) return;
    onChange([...selectedIds, skillId]);
  }

  if (options.length === 0) return <p className="admin-note">{labels.empty}</p>;

  return (
    <div className="tagpicker">
      {/* 上半部分模拟一个输入框：装已选标签，右侧显示剩余额度。 */}
      <div className="tagpicker__box" data-disabled={disabled || undefined}>
        <div className="tagpicker__selected">
          {selectedTags.length === 0 ? (
            <span className="tagpicker__placeholder">{labels.empty}</span>
          ) : (
            selectedTags.map((tag) => (
              <span className="tagpicker__chip" key={tag.id}>
                {tag.name}
                {!tag.isActive ? (
                  <small className="tagpicker__chip-status">{labels.inactive}</small>
                ) : null}
                <button
                  type="button"
                  className="tagpicker__chip-remove"
                  disabled={disabled}
                  aria-label={labels.remove.replace("{name}", tag.name)}
                  onClick={() => toggle(tag.id)}
                >
                  ×
                </button>
              </span>
            ))
          )}
        </div>
        <span className="tagpicker__remaining" role="status" aria-live="polite">
          {labels.remaining.replace("{count}", String(remaining))}
        </span>
      </div>

      {/* 候选一行铺开：已选中的高亮，再点一次即取消（与上半部分等价，两处都能操作）。 */}
      <div className="tagpicker__options" role="group">
        {options.map((option) => {
          const isSelected = selected.has(option.id);
          return (
            <button
              key={option.id}
              type="button"
              className="tagpicker__option"
              aria-pressed={isSelected}
              disabled={disabled || (atLimit && !isSelected)}
              onClick={() => toggle(option.id)}
            >
              {option.name}
            </button>
          );
        })}
      </div>

      {atLimit ? (
        <p className="admin-note" role="status" aria-live="polite">
          {labels.limitReached.replace("{limit}", String(limit))}
        </p>
      ) : null}
    </div>
  );
}
