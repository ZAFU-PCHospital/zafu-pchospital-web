import { adminShared } from "@/config/admin";

/** 后台列表首屏骨架：行高与真实表格一致，数据到达时不再整块跳动。 */
export function AdminListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="admin-list admin-skeleton__list" role="status" aria-busy="true">
      <span className="sr-only">{adminShared.loading}</span>
      <span className="admin-skeleton__head" aria-hidden="true" />
      {Array.from({ length: rows }, (_, index) => (
        <span key={index} className="admin-skeleton__row" aria-hidden="true" />
      ))}
    </div>
  );
}
