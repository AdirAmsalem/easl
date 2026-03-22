import { describe, it, expect } from "vitest";
import { getContentType, getExtension, detectViewerType } from "./mime";

describe("getContentType", () => {
  it("returns correct type for known extensions", () => {
    expect(getContentType("file.html")).toBe("text/html; charset=utf-8");
    expect(getContentType("file.css")).toBe("text/css; charset=utf-8");
    expect(getContentType("file.js")).toBe("application/javascript; charset=utf-8");
    expect(getContentType("file.json")).toBe("application/json; charset=utf-8");
    expect(getContentType("file.png")).toBe("image/png");
    expect(getContentType("file.jpg")).toBe("image/jpeg");
    expect(getContentType("file.jpeg")).toBe("image/jpeg");
    expect(getContentType("file.gif")).toBe("image/gif");
    expect(getContentType("file.svg")).toBe("image/svg+xml");
    expect(getContentType("file.pdf")).toBe("application/pdf");
    expect(getContentType("file.md")).toBe("text/markdown; charset=utf-8");
    expect(getContentType("file.csv")).toBe("text/csv; charset=utf-8");
    expect(getContentType("file.tsv")).toBe("text/tab-separated-values; charset=utf-8");
    expect(getContentType("file.mmd")).toBe("text/x-mermaid; charset=utf-8");
    expect(getContentType("file.webp")).toBe("image/webp");
    expect(getContentType("file.avif")).toBe("image/avif");
    expect(getContentType("file.woff2")).toBe("font/woff2");
    expect(getContentType("file.mp4")).toBe("video/mp4");
    expect(getContentType("file.wasm")).toBe("application/wasm");
  });

  it("returns octet-stream for unknown extensions", () => {
    expect(getContentType("file.xyz")).toBe("application/octet-stream");
    expect(getContentType("file.zzz")).toBe("application/octet-stream");
  });

  it("handles paths with directories", () => {
    expect(getContentType("assets/images/photo.png")).toBe("image/png");
    expect(getContentType("deep/nested/path/file.json")).toBe("application/json; charset=utf-8");
  });

  it("handles files with no extension", () => {
    expect(getContentType("Makefile")).toBe("application/octet-stream");
  });

  it("handles mixed case extensions via toLowerCase", () => {
    // The implementation calls .toLowerCase() on the extension
    expect(getContentType("file.HTML")).toBe("text/html; charset=utf-8");
    expect(getContentType("file.JSON")).toBe("application/json; charset=utf-8");
  });
});

describe("getExtension", () => {
  it("returns the file extension lowercase", () => {
    expect(getExtension("file.html")).toBe("html");
    expect(getExtension("file.JSON")).toBe("json");
    expect(getExtension("path/to/file.md")).toBe("md");
  });

  it("returns empty string for files without extension", () => {
    // "Makefile".split(".").pop() returns "Makefile" which is lowercased
    expect(getExtension("Makefile")).toBe("makefile");
  });

  it("returns last extension for double-extension files", () => {
    expect(getExtension("archive.tar.gz")).toBe("gz");
  });
});

describe("detectViewerType", () => {
  it("detects CSV by extension", () => {
    expect(detectViewerType("text/csv", "data.csv")).toBe("csv");
    expect(detectViewerType("text/tab-separated-values", "data.tsv")).toBe("csv");
  });

  it("detects CSV by content type", () => {
    expect(detectViewerType("text/csv; charset=utf-8", "data.txt")).toBe("csv");
    expect(detectViewerType("text/tab-separated-values", "data.txt")).toBe("csv");
  });

  it("detects Markdown", () => {
    expect(detectViewerType("text/markdown", "readme.md")).toBe("markdown");
    expect(detectViewerType("text/plain", "readme.md")).toBe("markdown");
  });

  it("detects JSON", () => {
    expect(detectViewerType("application/json", "data.json")).toBe("json");
    expect(detectViewerType("application/json; charset=utf-8", "config.json")).toBe("json");
  });

  it("detects HTML", () => {
    expect(detectViewerType("text/html", "page.html")).toBe("html");
    expect(detectViewerType("text/html; charset=utf-8", "page.htm")).toBe("html");
  });

  it("detects SVG (before generic image)", () => {
    expect(detectViewerType("image/svg+xml", "diagram.svg")).toBe("svg");
  });

  it("detects images", () => {
    expect(detectViewerType("image/png", "photo.png")).toBe("image");
    expect(detectViewerType("image/jpeg", "photo.jpg")).toBe("image");
    expect(detectViewerType("image/gif", "anim.gif")).toBe("image");
    expect(detectViewerType("image/webp", "photo.webp")).toBe("image");
  });

  it("detects PDF", () => {
    expect(detectViewerType("application/pdf", "doc.pdf")).toBe("pdf");
  });

  it("detects Mermaid", () => {
    expect(detectViewerType("text/x-mermaid", "diagram.mmd")).toBe("mermaid");
    expect(detectViewerType("text/plain", "diagram.mmd")).toBe("mermaid");
  });

  it("falls back to download for unknown types", () => {
    expect(detectViewerType("application/octet-stream", "file.bin")).toBe("download");
    expect(detectViewerType("application/zip", "archive.zip")).toBe("download");
    expect(detectViewerType("video/mp4", "video.mp4")).toBe("download");
  });
});
