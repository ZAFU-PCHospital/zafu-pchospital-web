"use client";

import { useEffect, useMemo, useState } from "react";

import { Icon } from "@/components/ui/Icon";
import { allCategoryId } from "@/config/tools";
import { categoryAlias, keywordOf, siteAlias } from "@/features/tools/tool-aliases";
import { cn } from "@/lib/utils";
import type { PublicToolGroup } from "@/types/contracts";

/**
 * ToolDirectory —— 工具网址目录
 *
 * 对应 /docs 工具索引页下半部分：标题 + 搜索框 + 分类筛选 + 分组卡片网格。
 * 搜索与筛选是客户端状态，**数据由服务端传入**（数据库优先，见 `features/tools/tool-service`），
 * 后台 `/admin/tools` 的改动因此不需要动这个组件。
 *
 * 样式见 ../app/docs/tools.css 的 .tp-* 系列，按设计稿复刻。
 */

type ToolEntry = PublicToolGroup["sites"][number];

function ToolCard({ site }: { site: ToolEntry }) {
  return (
    <a
      className="tp-card"
      href={site.href}
      target="_blank"
      rel="noopener noreferrer"
      title={`${site.name} · ${site.description}`}
    >
      <span className="tp-card__icon" aria-hidden="true">
        {site.name.slice(0, 1)}
      </span>
      <span className="tp-card__body">
        <strong className="tp-card__name">{site.name}</strong>
        <span className="tp-card__desc">{site.description}</span>
      </span>
      <Icon name="arrowUpRight" className="tp-card__arrow" />
    </a>
  );
}

function ToolGroup({ group }: { group: PublicToolGroup }) {
  return (
    <section className="tp-group">
      <div className="tp-group__head">
        <h3 className="tp-group__name">
          {group.label}
          <em>{group.sites.length}</em>
        </h3>
        <span className="tp-group__en">{group.labelEn}</span>
      </div>

      <ul className="tp-grid">
        {group.sites.map((site) => (
          <li key={site.id}>
            <ToolCard site={site} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ToolDirectory({ groups }: { groups: readonly PublicToolGroup[] }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<string>(allCategoryId);

  const total = groups.reduce((sum, group) => sum + group.sites.length, 0);
  // 与搜「驱动 下载」同样的归一化：大小写与空格都不该影响命中。
  const keyword = keywordOf(query);
  const filtered = Boolean(keyword) || active !== allCategoryId;

  const visibleGroups = useMemo(() => {
    const scoped = active === allCategoryId ? groups : groups.filter((g) => g.id === active);
    if (!keyword) return scoped;

    return scoped
      .map((group) => {
        // 分类名或分类别名命中，就让整组都留下：搜「学校」应看到学校官网的全部条目。
        const categoryMatches = keywordOf(
          `${group.label}${group.labelEn}${categoryAlias(group.label)}`,
        ).includes(keyword);

        return {
          ...group,
          sites: categoryMatches
            ? group.sites
            : group.sites.filter((site) =>
                keywordOf(`${site.name}${site.description}${siteAlias(site.href)}`).includes(
                  keyword,
                ),
              ),
        };
      })
      .filter((group) => group.sites.length > 0);
  }, [groups, active, keyword]);

  const visibleCount = visibleGroups.reduce((sum, group) => sum + group.sites.length, 0);
  let statusText = `共 ${total} 个工具`;
  if (filtered) statusText = `找到 ${visibleCount} 个工具`;
  if (visibleCount === 0) statusText = "没有匹配的工具";

  /**
   * 后台删掉某个分类后，筛选仍停在这个已不存在的分类上会只剩空列表。
   * 分组列表变化时把它退回「全部」，避免访客以为工具都没了。
   */
  useEffect(() => {
    if (active === allCategoryId) return;
    if (!groups.some((group) => group.id === active)) setActive(allCategoryId);
  }, [groups, active]);

  // 一组都没配时不留一个只有标题的空壳页面。
  if (total === 0) return null;

  return (
    <div className="tp-dir">
      <div className="tp-dir__head">
        <h2>工具目录</h2>
        <span>{filtered ? `${visibleCount} 个` : `${total} 个工具`}</span>
      </div>

      {/* 筛选只改变视觉，读屏用户听不到卡片增减，这里补一条播报。 */}
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {statusText}
      </span>

      <div className="tp-search">
        <Icon name="zoomIn" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索工具，例如「驱动」「解压」……"
          aria-label="搜索工具"
          enterKeyHint="search"
        />
      </div>

      <div className="tp-filters" role="group" aria-label="工具分类">
        <button
          type="button"
          aria-pressed={active === allCategoryId}
          className={cn("tp-filter", active === allCategoryId && "is-on")}
          onClick={() => setActive(allCategoryId)}
        >
          全部 {total}
        </button>
        {groups.map((group) => (
          <button
            key={group.id}
            type="button"
            aria-pressed={active === group.id}
            className={cn("tp-filter", active === group.id && "is-on")}
            onClick={() => setActive(group.id)}
          >
            {group.label} {group.sites.length}
          </button>
        ))}
      </div>

      {visibleGroups.map((group) => (
        <ToolGroup key={group.id} group={group} />
      ))}

      {visibleGroups.length === 0 ? (
        <p className="tp-empty">没有匹配的工具，换个关键词或分类试试</p>
      ) : null}
    </div>
  );
}
