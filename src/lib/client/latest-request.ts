/** 每个组件实例独享；失效后即使传输层仍返回，旧结果也不能提交到视图。 */
export function createLatestRequest() {
  let current: AbortController | null = null;
  let generation = 0;
  const invalidate = () => {
    generation++;
    const previous = current;
    current = null;
    previous?.abort();
  };
  return {
    invalidate,
    begin() {
      invalidate();
      const controller = new AbortController();
      const started = generation;
      current = controller;
      return {
        signal: controller.signal,
        isCurrent: () => generation === started,
        finish() {
          if (current === controller) current = null;
        },
      };
    },
  };
}
