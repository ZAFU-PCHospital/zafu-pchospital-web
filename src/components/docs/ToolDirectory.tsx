"use client";

import { useMemo, useState } from "react";

import { Icon } from "@/components/ui/Icon";
import { allCategoryId, toolCategories, toolCount, type ToolCategory } from "@/config/tools";
import { cn } from "@/lib/utils";

/**
 * ToolDirectory —— 工具网址目录
 *
 * 对应 /docs 工具索引页下半部分：标题 + 搜索框 + 分类筛选 + 分组卡片网格。
 * 搜索与筛选是客户端状态，数据来自 src/config/tools.ts。
 *
 * 样式见 ../app/docs/tools.css 的 .tp-* 系列，按设计稿复刻。
 */

function ToolCard({ name, description, href }: { name: string; description: string; href: string }) {
  return (
    <a
      className="tp-card"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={`${name} · 官方网站`}
    >
      <span className="tp-card__icon" aria-hidden="true">
        {name.slice(0, 1)}
      </span>
      <span className="tp-card__body">
        <strong className="tp-card__name">{name}</strong>
        <span className="tp-card__desc">{description}</span>
      </span>
      <Icon name="arrowUpRight" className="tp-card__arrow" />
    </a>
  );
}

function ToolGroup({ category }: { category: ToolCategory }) {
  return (
    <section className="tp-group">
      <div className="tp-group__head">
        <h3 className="tp-group__name">
          {category.label}
          <em>{category.tools.length}</em>
        </h3>
        <span className="tp-group__en">{category.labelEn}</span>
      </div>

      <ul className="tp-grid">
        {category.tools.map((tool) => (
          <li key={tool.name}>
            <ToolCard {...tool} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ToolDirectory() {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<string>(allCategoryId);

  const keyword = query.trim().toLowerCase();
  const filtered = Boolean(keyword) || active !== allCategoryId;

  const visibleCategories = useMemo(() => {
    const categories =
      active === allCategoryId ? toolCategories : toolCategories.filter((c) => c.id === active);

    if (!keyword) return categories;

    return categories
      .map((cat) => ({
        ...cat,
        tools: cat.tools.filter(
          (t) =>
            t.name.toLowerCase().includes(keyword) || t.description.toLowerCase().includes(keyword),
        ),
      }))
      .filter((cat) => cat.tools.length > 0);
  }, [active, keyword]);

  const visibleCount = visibleCategories.reduce((sum, cat) => sum + cat.tools.length, 0);

  return (
    <div className="tp-dir">
      <div className="tp-dir__head">
        <h2>工具目录</h2>
        <span>{filtered ? `${visibleCount} 个` : `${toolCount} 个工具`}</span>
      </div>

      <div className="tp-search">
        <Icon name="zoomIn" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索工具名称，例如「驱动」「解压」……（Esc 清空）"
          aria-label="搜索工具"
          onKeyDown={(e) => {
            if (e.key === "Escape") setQuery("");
          }}
        />
      </div>

      <div className="tp-filters" role="group" aria-label="工具分类">
        <button
          type="button"
          aria-pressed={active === allCategoryId}
          className={cn("tp-filter", active === allCategoryId && "is-on")}
          onClick={() => setActive(allCategoryId)}
        >
          全部 {toolCount}
        </button>
        {toolCategories.map((cat) => (
          <button
            key={cat.id}
            type="button"
            aria-pressed={active === cat.id}
            className={cn("tp-filter", active === cat.id && "is-on")}
            onClick={() => setActive(cat.id)}
          >
            {cat.label} {cat.tools.length}
          </button>
        ))}
      </div>

      {visibleCategories.map((cat) => (
        <ToolGroup key={cat.id} category={cat} />
      ))}

      {visibleCategories.length === 0 ? (
        <p className="tp-empty">没有匹配的工具，换个关键词试试。</p>
      ) : null}
    </div>
  );
}
