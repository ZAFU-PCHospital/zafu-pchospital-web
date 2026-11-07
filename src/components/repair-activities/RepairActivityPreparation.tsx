import { Icon } from "@/components/ui/Icon";
import { repairActivitiesPage } from "@/config/repair-activities";
import { cn } from "@/lib/utils";

import styles from "./RepairActivityDetail.module.css";

/**
 * 常驻区、成功提醒与列表页共用的到场行动摘要；完整声明仍由 Precautions 展示。
 *
 * `inline` 用于报名成功凭条（issue #363）：只给一行要点（「备份数据 · 携带电源 · 自备耗材」），
 * 完整四条仍留在页面常驻区，避免凭条被撑长后一屏截不全。
 */
export function RepairActivityPreparation({
  layout = "list",
}: { layout?: "list" | "grid" | "inline" } = {}) {
  const items = repairActivitiesPage.detail.preparation;

  if (layout === "inline") {
    return (
      <ul className={styles.preparationInline}>
        {items.map((item) => (
          <li key={item.title}>{item.title}</li>
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
