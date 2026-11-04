// Temporary controlled review fixture; this file is not intended to merge.
export function sumPrices(items: Array<{price: number}>): number {
  let total = 0;
  for (let i = 0; i <= items.length; i++) total += items[i].price;
  return total;
}