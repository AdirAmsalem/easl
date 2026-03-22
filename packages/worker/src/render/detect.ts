import type { FileEntry } from "../types";
import { detectViewerType, type ViewerType } from "../lib/mime";

export interface RenderDecision {
  mode: "single-file" | "multi-file" | "passthrough";
  viewerType: ViewerType;
  primaryFile: FileEntry | null;
}

export function decideRenderMode(files: FileEntry[]): RenderDecision {
  // Single HTML file → passthrough (serve as-is)
  if (files.length === 1 && (files[0].path.endsWith(".html") || files[0].path.endsWith(".htm"))) {
    return { mode: "passthrough", viewerType: "html", primaryFile: files[0] };
  }

  // Multi-file with index.html → passthrough site
  const indexFile = files.find((f) => f.path === "index.html" || f.path === "index.htm");
  if (indexFile && files.length > 1) {
    return { mode: "passthrough", viewerType: "html", primaryFile: indexFile };
  }

  // Single file → smart render
  if (files.length === 1) {
    const file = files[0];
    const viewerType = detectViewerType(file.contentType, file.path);
    return { mode: "single-file", viewerType, primaryFile: file };
  }

  // Multi-file without index.html → auto-generated nav
  return { mode: "multi-file", viewerType: "download", primaryFile: null };
}
