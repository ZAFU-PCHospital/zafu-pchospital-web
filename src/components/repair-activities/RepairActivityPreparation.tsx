import { Icon } from "@/components/ui/Icon";
import { repairActivitiesPage } from "@/config/repair-activities";
import { cn } from "@/lib/utils";

import styles from "./RepairActivityDetail.module.css";

/**
 * 常驻区、成功提醒与列表页共用的到场行动摘要；完整声明仍由 Precautions 展示。
 *
 * - `compact`：两列图标 + 标题（不带描述），用于报名成功凭条下方的到场准备模块。
 */
export function RepairActivityPreparation({
  layout = "list",
}: { layout?: "list" | "grid" | "compact" } = {}) {
  const items = repairActivitiesPage.detail.preparation;

  if (layout === "compact") {
    return (
      <ul className={styles.preparationCompact}>
        {items.map((item) => (
          <li key={item.title}>
            <Icon name={item.icon} />
            <span>{item.title}</span>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <ul className={cn(styles.preparation, layout === "grid" && styles.preparationGrid)}>
      {items.map((item) => (
        <li key={item.title}>
          <Icon name={item.icon} />
          <div>
            <h3>{item.title}</h3>
            <p>{item.description}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
