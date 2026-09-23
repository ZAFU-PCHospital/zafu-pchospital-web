import { Section } from "@/components/ui/Section";
import { adminShared } from "@/config/admin";

/**
 * `/admin/**` 的导航加载态。
 *
 * 后台路由都是动态渲染（要读会话），Next 在拿到新的 RSC 载荷之前会先渲染这一屏。
 * 有它之后，点击侧栏的瞬间就出现骨架，而不是「界面卡在原地、几百毫秒后才整页换掉」——
 * 那种「点下去没反应」的停顿感，一半来自缺少这个边界。
 *
 * **外壳必须与真实页面逐层一致**（`Section variant="page-head"` → `Container` →
 * `.admin-workspace__content`）。第一版只渲染了 `.admin-workspace__content`，
 * 少了外面那两层：内容整体比真实页面高 16px、左边也少一层内边距，
 * 载荷到达时整页往下跳一格 —— 用户看到的就是「切页抖一下」。骨架的价值在于
 * **占据和真实内容一样的位置**，位置不对还不如没有。
 *
 * 骨架用 `--surface-2` 的块表示（不加动效，符合设计基准「不做装饰性动画」）。
 */
export default function AdminLoading() {
  return (
    <Section variant="page-head" className="admin-workspace">
      <div className="admin-workspace__content" aria-busy="true" aria-live="polite">
        <p className="sr-only" role="status">
          {adminShared.loading}
        </p>
        {/* 页头：标题 + 一句说明 */}
        <div className="admin-skeleton">
          <span className="admin-skeleton__title" />
          <span className="admin-skeleton__line" />
        </div>
        {/* 筛选栏 */}
        <div className="admin-skeleton admin-skeleton--filters">
          <span className="admin-skeleton__field" />
          <span className="admin-skeleton__field" />
          <span className="admin-skeleton__field" />
        </div>
        {/* 列表面板：顶栏 + 若干行 */}
        <div className="admin-list admin-skeleton__list">
          {Array.from({ length: 6 }, (_, index) => (
            <span key={index} className="admin-skeleton__row" />
          ))}
        </div>
      </div>
    </Section>
  );
}
