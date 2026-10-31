import { Icon } from "@/components/ui/Icon";
import { repairActivitiesPage } from "@/config/repair-activities";
import { cn } from "@/lib/utils";

import styles from "./RepairActivityDetail.module.css";

/** 常驻区、成功提醒与列表页共用的到场行动摘要；完整声明仍由 Precautions 展示。 */
export function RepairActivityPreparation({ layout = "list" }: { layout?: "list" | "grid" } = {}) {
  return (
    <ul className={cn(styles.preparation, layout === "grid" && styles.preparationGrid)}>
      {repairActivitiesPage.detail.preparation.map((item) => (
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
