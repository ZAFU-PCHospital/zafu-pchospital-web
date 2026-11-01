"use client";

import Image from "next/image";
import { useEffect, useState, type ReactNode } from "react";

import { repairPhotoCopy } from "@/config/repairs";
import { cn } from "@/lib/utils";
import type { RepairPhotoView } from "@/types/contracts";

import { PhotoLightbox } from "./PhotoLightbox";
import { fillPhotoCopy } from "./photo-browse";

type Props = {
  photos: RepairPhotoView[];
  /** 缩略图下方的操作区（排序 / 移除），由详情页决定是否出现。 */
  renderActions?: (photo: RepairPhotoView, index: number) => ReactNode;
  /** 审核端保留原有文件名提示；成员详情不需要。 */
  showOriginalName?: boolean;
  className?: string;
};

/**
 * RepairPhotoGallery —— 详情与审核端共用的照片缩略图网格。
 *
 * 网格只请求 `thumbnailUrl`（320 长边），打开灯箱后才取 `contentUrl`（display）；
 * 缩略图容器固定 4:3 并带固有宽高，图片加载前后不产生布局跳动。
 * 单张读取失败显示占位而非裂图，也不提供会返回 JSON 错误页的原图链接。
 */
export function RepairPhotoGallery({
  photos,
  renderActions,
  showOriginalName = false,
  className,
}: Props) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [broken, setBroken] = useState<string[]>([]);

  useEffect(() => {
    setOpenIndex((current) => (current !== null && current >= photos.length ? null : current));
  }, [photos.length]);

  return (
    <div className={cn("photo-grid", className)}>
      <ul className="photo-grid__list">
        {photos.map((photo, index) => {
          const alt = fillPhotoCopy(repairPhotoCopy.alt, {
            index: index + 1,
            count: photos.length,
          });
          const openLabel = fillPhotoCopy(repairPhotoCopy.open, {
            index: index + 1,
            count: photos.length,
          });
          return (
            <li className="photo-grid__cell" key={photo.id}>
              {broken.includes(photo.id) ? (
                <div className="photo-grid__fallback" role="group" aria-label={alt}>
                  <span>{repairPhotoCopy.unavailable}</span>
                </div>
              ) : (
                <button
                  type="button"
                  className="photo-grid__button"
                  onClick={() => setOpenIndex(index)}
                  aria-label={openLabel}
                >
                  <Image
                    className="photo-grid__image"
                    src={photo.thumbnailUrl}
                    alt={alt}
                    width={photo.width ?? 320}
                    height={photo.height ?? 240}
                    unoptimized
                    loading="lazy"
                    decoding="async"
                    onError={() =>
                      setBroken((current) =>
                        current.includes(photo.id) ? current : [...current, photo.id],
                      )
                    }
                  />
                </button>
              )}
              {showOriginalName && photo.originalName ? (
                <span className="photo-grid__meta">{photo.originalName}</span>
              ) : null}
              {renderActions ? (
                <div className="photo-grid__actions">{renderActions(photo, index)}</div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {openIndex !== null ? (
        <PhotoLightbox
          photos={photos}
          index={openIndex}
          onIndexChange={setOpenIndex}
          onClose={() => setOpenIndex(null)}
        />
      ) : null}
    </div>
  );
}
