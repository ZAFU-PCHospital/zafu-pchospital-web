/** 通知 / 收藏列表骨架：按社区列表行高占位，避免加载完成后整块跳动。 */
export function CommunityListSkeleton({ label, rows = 4 }: { label: string; rows?: number }) {
  return (
    <div className="community-list community-skeleton" role="status" aria-busy="true">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <span key={index} className="community-skeleton__row" aria-hidden="true" />
      ))}
    </div>
  );
}
