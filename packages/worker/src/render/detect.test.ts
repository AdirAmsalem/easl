import { describe, it, expect } from "vitest";
import { decideRenderMode } from "./detect";
import type { FileEntry } from "../types";

function makeFile(path: string, contentType: string, size = 1000): FileEntry {
  return { path, size, contentType };
}

describe("decideRenderMode", () => {
  describe("single HTML file → passthrough", () => {
    it("returns passthrough for .html file", () => {
      const result = decideRenderMode([makeFile("index.html", "text/html")]);
      expect(result.mode).toBe("passthrough");
      expect(result.viewerType).toBe("html");
      expect(result.primaryFile?.path).toBe("index.html");
    });

    it("returns passthrough for .htm file", () => {
      const result = decideRenderMode([makeFile("page.htm", "text/html")]);
      expect(result.mode).toBe("passthrough");
      expect(result.viewerType).toBe("html");
    });
  });

  describe("multi-file with index.html → passthrough", () => {
    it("returns passthrough with index.html as primary", () => {
      const result = decideRenderMode([
        makeFile("index.html", "text/html"),
        makeFile("style.css", "text/css"),
        makeFile("app.js", "application/javascript"),
      ]);
      expect(result.mode).toBe("passthrough");
      expect(result.viewerType).toBe("html");
      expect(result.primaryFile?.path).toBe("index.html");
    });

    it("returns passthrough with index.htm as primary", () => {
      const result = decideRenderMode([
        makeFile("index.htm", "text/html"),
        makeFile("image.png", "image/png"),
      ]);
      expect(result.mode).toBe("passthrough");
      expect(result.primaryFile?.path).toBe("index.htm");
    });
  });

  describe("single non-HTML file → single-file smart render", () => {
    it("detects CSV viewer", () => {
      const result = decideRenderMode([makeFile("data.csv", "text/csv")]);
      expect(result.mode).toBe("single-file");
      expect(result.viewerType).toBe("csv");
    });

    it("detects Markdown viewer", () => {
      const result = decideRenderMode([makeFile("readme.md", "text/markdown")]);
      expect(result.mode).toBe("single-file");
      expect(result.viewerType).toBe("markdown");
    });

    it("detects JSON viewer", () => {
      const result = decideRenderMode([makeFile("config.json", "application/json")]);
      expect(result.mode).toBe("single-file");
      expect(result.viewerType).toBe("json");
    });

    it("detects image viewer", () => {
      const result = decideRenderMode([makeFile("photo.png", "image/png")]);
      expect(result.mode).toBe("single-file");
      expect(result.viewerType).toBe("image");
    });

    it("detects PDF viewer", () => {
      const result = decideRenderMode([makeFile("doc.pdf", "application/pdf")]);
      expect(result.mode).toBe("single-file");
      expect(result.viewerType).toBe("pdf");
    });

    it("detects SVG viewer", () => {
      const result = decideRenderMode([makeFile("diagram.svg", "image/svg+xml")]);
      expect(result.mode).toBe("single-file");
      expect(result.viewerType).toBe("svg");
    });

    it("detects Mermaid viewer", () => {
      const result = decideRenderMode([makeFile("flow.mmd", "text/x-mermaid")]);
      expect(result.mode).toBe("single-file");
      expect(result.viewerType).toBe("mermaid");
    });

    it("falls back to download for unknown types", () => {
      const result = decideRenderMode([makeFile("archive.zip", "application/zip")]);
      expect(result.mode).toBe("single-file");
      expect(result.viewerType).toBe("download");
    });
  });

  describe("multi-file without index.html → multi-file nav", () => {
    it("returns multi-file mode", () => {
      const result = decideRenderMode([
        makeFile("data.csv", "text/csv"),
        makeFile("readme.md", "text/markdown"),
        makeFile("config.json", "application/json"),
      ]);
      expect(result.mode).toBe("multi-file");
      expect(result.viewerType).toBe("download");
      expect(result.primaryFile).toBeNull();
    });
  });
});
