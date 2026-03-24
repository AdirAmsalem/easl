import satori from "satori";
import { Resvg, initWasm } from "@resvg/resvg-wasm";
// @ts-expect-error — Cloudflare Workers support direct WASM imports
import resvgWasm from "../node_modules/@resvg/resvg-wasm/index_bg.wasm";
import type { Env } from "./types";

// ─── Per-isolate caches ───
let wasmReady = false;
let fontData: ArrayBuffer | null = null;

async function ensureWasm(): Promise<void> {
  if (wasmReady) return;
  await initWasm(resvgWasm);
  wasmReady = true;
}

async function getFont(): Promise<ArrayBuffer> {
  if (fontData) return fontData;
  // Use .woff — Satori's opentype.js doesn't support woff2
  const res = await fetch(
    "https://cdn.jsdelivr.net/fontsource/fonts/inter@latest/latin-400-normal.woff",
  );
  fontData = await res.arrayBuffer();
  return fontData;
}

// ─── Content type labels ───
const TYPE_LABELS: Record<string, string> = {
  "text/csv": "CSV",
  "text/markdown": "Markdown",
  "application/json": "JSON",
  "text/html": "HTML",
  "image/svg+xml": "SVG",
  "text/x-mermaid": "Diagram",
  "text/plain": "Text",
  "application/pdf": "PDF",
};

function getTypeLabel(contentType: string): string {
  const base = contentType.split(";")[0].trim();
  return TYPE_LABELS[base] ?? "File";
}

// ─── Generate OG image ───
export async function generateOgImage(opts: {
  title: string;
  slug: string;
  contentType: string;
  domain: string;
}): Promise<ArrayBuffer> {
  const [font] = await Promise.all([getFont(), ensureWasm()]);
  const typeLabel = getTypeLabel(opts.contentType);

  const svg = await satori(
    {
      type: "div",
      props: {
        style: {
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "60px 70px",
          background: "linear-gradient(145deg, #0a0a0a 0%, #1a1a1a 50%, #0f0f0f 100%)",
          fontFamily: "Inter",
        },
        children: [
          // Top: easl branding
          {
            type: "div",
            props: {
              style: {
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              },
              children: [
                {
                  type: "div",
                  props: {
                    style: { fontSize: 28, color: "#737373", fontWeight: 600 },
                    children: "easl",
                  },
                },
                {
                  type: "div",
                  props: {
                    style: {
                      fontSize: 18,
                      color: "#1a1a1a",
                      background: "#60a5fa",
                      padding: "6px 18px",
                      borderRadius: 8,
                      fontWeight: 600,
                    },
                    children: typeLabel,
                  },
                },
              ],
            },
          },
          // Center: title
          {
            type: "div",
            props: {
              style: {
                display: "flex",
                flexDirection: "column",
                gap: 16,
                flex: 1,
                justifyContent: "center",
              },
              children: [
                {
                  type: "div",
                  props: {
                    style: {
                      fontSize: opts.title.length > 40 ? 48 : 60,
                      fontWeight: 700,
                      color: "#ffffff",
                      lineHeight: 1.15,
                      letterSpacing: "-0.03em",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    },
                    children: opts.title.length > 80 ? opts.title.slice(0, 77) + "..." : opts.title,
                  },
                },
              ],
            },
          },
          // Bottom: URL
          {
            type: "div",
            props: {
              style: {
                fontSize: 22,
                color: "#525252",
                fontWeight: 500,
              },
              children: `${opts.slug}.${opts.domain}`,
            },
          },
        ],
      },
    },
    {
      width: 1200,
      height: 630,
      fonts: [
        {
          name: "Inter",
          data: font,
          weight: 400,
          style: "normal" as const,
        },
      ],
    },
  );

  const resvg = new Resvg(svg, {
    fitTo: { mode: "width" as const, value: 1200 },
  });
  const png = resvg.render();
  return png.asPng().buffer as ArrayBuffer;
}
