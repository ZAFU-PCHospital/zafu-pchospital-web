/** 集成/单元测试用的真实小图；fake magic bytes 已无法通过 sharp 解码。 */
export const TINY_PNG_BYTES = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWM4oaGBFTEMLQkAgl1GAXRgBQ4AAAAASUVORK5CYII=",
    "base64",
  ),
);

export const TINY_JPEG_BYTES = Uint8Array.from(
  Buffer.from(
    "/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAIAAgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABv/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AIAB6Ev/2Q==",
    "base64",
  ),
);

export function tinyPngFile(name = "fixture.png"): File {
  return new File([TINY_PNG_BYTES], name, { type: "image/png" });
}

export function tinyJpegFile(name = "fixture.jpg"): File {
  return new File([TINY_JPEG_BYTES], name, { type: "image/jpeg" });
}
