import { Fragment } from "react";

import { tickerItems } from "@/config/home";

/**
 * Ticker —— 跑马灯
 *
 * 对应设计基准的 `.ticker`。内容数组渲染两遍，靠 `translateX(-50%)` 无缝衔接。
 * 纯装饰，对辅助技术隐藏。
 */

export function Ticker() {
  return (
    <div className="ticker" aria-hidden="true">
      <div className="ticker__track">
        {[0, 1].map((copy) => (
          <div className="ticker__group" key={copy}>
            {tickerItems.map((item, index) => (
              <Fragment key={`${copy}-${item}`}>
                {index > 0 ? <i /> : null}
                <span>{item}</span>
              </Fragment>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
