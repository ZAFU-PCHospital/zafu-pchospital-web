import { Icon } from "@/components/ui/Icon";
import { repairActivitiesPage } from "@/config/repair-activities";
import { cn } from "@/lib/utils";

import styles from "./RepairActivityDetail.module.css";

/**
 * 常驻区、报名详情与列表页共用的到场行动摘要；完整声明仍由 Precautions 展示。
 *
 * - `cards`：报名详情卡片下方的四张说明卡，标题与描述全部沿用同一份配置。
 */
export function RepairActivityPreparation({
  layout = "list",
}: { layout?: "list" | "grid" | "cards" } = {}) {
  const items = repairActivitiesPage.detail.preparation;

  if (layout === "cards") {
    return (
      <ul className={styles.preparationCards}>
        {items.map((item) => (
          <li key={item.title}>
            <span className={styles.preparationCardIcon}>
              <Icon name={item.icon} />
            </span>
            <div>
              <h3>{item.title}</h3>
              <p>{item.description}</p>
            </div>
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
