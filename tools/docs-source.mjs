import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

/** 构建与调色板校验必须读取同一份文档源码。 */
export function resolveDocsSourceRoot(projectRoot) {
  if (process.env.DOCS_SOURCE_DIR) return path.resolve(projectRoot, process.env.DOCS_SOURCE_DIR);
  const checkout = path.join(projectRoot, ".docs-source");
  if (existsSync(checkout)) return checkout;
  const sibling = path.resolve(projectRoot, "..", "ZAFU-PCHospital-Doc");
  return existsSync(sibling) ? sibling : checkout;
}
