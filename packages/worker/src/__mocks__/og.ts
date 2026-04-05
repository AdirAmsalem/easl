// Stub for e2e tests — real OG image generation uses WASM that can't load in the test runtime
export async function generateOgImage(_opts: {
  title: string;
  slug: string;
  contentType: string;
  domain: string;
}): Promise<ArrayBuffer> {
  return new ArrayBuffer(0);
}
