const MIME_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "application/javascript; charset=utf-8",
  mjs: "application/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  webp: "image/webp",
  avif: "image/avif",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
  pdf: "application/pdf",
  xml: "application/xml",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  tsv: "text/tab-separated-values; charset=utf-8",
  mmd: "text/x-mermaid; charset=utf-8",
  wasm: "application/wasm",
  map: "application/json",
};

export function getContentType(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return MIME_TYPES[ext] ?? "application/octet-stream";
}

export function getExtension(path: string): string {
  return path.split(".").pop()?.toLowerCase() ?? "";
}

// Detect the viewer type for a given content type
export type ViewerType =
  | "csv"
  | "markdown"
  | "json"
  | "html"
  | "image"
  | "pdf"
  | "svg"
  | "mermaid"
  | "download"; // fallback

export function detectViewerType(contentType: string, path: string): ViewerType {
  const ext = getExtension(path);

  if (ext === "csv" || ext === "tsv" || contentType.includes("text/csv") || contentType.includes("tab-separated")) {
    return "csv";
  }
  if (ext === "md" || contentType.includes("text/markdown")) {
    return "markdown";
  }
  if (ext === "json" || contentType.includes("application/json")) {
    return "json";
  }
  if (ext === "html" || ext === "htm" || contentType.includes("text/html")) {
    return "html";
  }
  if (contentType.startsWith("image/svg") || ext === "svg") {
    return "svg";
  }
  if (contentType.startsWith("image/")) {
    return "image";
  }
  if (ext === "pdf" || contentType.includes("application/pdf")) {
    return "pdf";
  }
  if (ext === "mmd" || contentType.includes("text/x-mermaid")) {
    return "mermaid";
  }

  return "download";
}
