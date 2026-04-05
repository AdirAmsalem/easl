#!/usr/bin/env node

import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

type Json = Record<string, unknown>;

declare const __PACKAGE_VERSION__: string | undefined;
const version: string = typeof __PACKAGE_VERSION__ !== "undefined" ? __PACKAGE_VERSION__ : "0.0.0-dev";

const API_URL = (process.env.EASL_API_URL ?? "https://api.easl.dev").replace(/\/$/, "");

// Session state: track published sites for list_sites
const sessionSites: Array<{ slug: string; claimToken: string; url: string; createdAt: string }> = [];

const server = new Server(
  { name: "easl", version },
  { capabilities: { tools: {} } },
);

const toolDefinitions = [
  {
    name: "publish_content",
    description:
      "Publish raw content (Markdown, CSV, HTML, JSON, SVG, Mermaid) as a shareable page. The fastest way — content goes in, URL comes out. Max 256KB.",
    inputSchema: {
      type: "object" as const,
      properties: {
        content: { type: "string", description: "Raw content to publish" },
        contentType: {
          type: "string",
          description: "MIME type: text/markdown, text/csv, text/html, application/json, image/svg+xml, text/x-mermaid",
        },
        title: { type: "string", description: "Optional title for the page" },
        template: { type: "string", description: "Optional template: minimal, report, dashboard" },
      },
      required: ["content", "contentType"],
    },
  },
  {
    name: "publish_file",
    description:
      "Publish a single file from disk — returns a URL to a shareable page. easl auto-detects the file type and renders it with the best viewer.",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "Absolute path to the file" },
        title: { type: "string", description: "Optional title" },
        template: { type: "string", description: "Optional template: minimal, report, dashboard" },
      },
      required: ["path"],
    },
  },
  {
    name: "publish_site",
    description:
      "Publish a directory of files as a site. If the directory has an index.html, it's served as-is. Otherwise, easl auto-generates navigation.",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "Absolute path to the directory" },
        title: { type: "string", description: "Optional title" },
        template: { type: "string", description: "Optional template" },
      },
      required: ["path"],
    },
  },
  {
    name: "list_sites",
    description: "List sites published in this session.",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "delete_site",
    description: "Delete a site by slug. Uses the claim token from the session.",
    inputSchema: {
      type: "object" as const,
      properties: {
        slug: { type: "string", description: "Site slug to delete" },
      },
      required: ["slug"],
    },
  },
] as const;

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...toolDefinitions] }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  const args = (request.params.arguments ?? {}) as Json;

  try {
    switch (name) {
      case "publish_content": return successResult(await publishContent(args));
      case "publish_file": return successResult(await publishFile(args));
      case "publish_site": return successResult(await publishSite(args));
      case "list_sites": return successResult({ sites: sessionSites });
      case "delete_site": return successResult(await deleteSite(args));
      default: return errorResult(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }
});

async function publishContent(args: Json): Promise<Json> {
  const content = requireString(args.content, "content");
  const contentType = requireString(args.contentType, "contentType");

  const result = await apiRequest<Json>("POST", "/publish", {
    content,
    contentType,
    title: typeof args.title === "string" ? args.title : undefined,
    template: typeof args.template === "string" ? args.template : undefined,
  });

  sessionSites.push({
    slug: result.slug as string,
    claimToken: result.claimToken as string,
    url: result.url as string,
    createdAt: new Date().toISOString(),
  });

  return result;
}

async function publishFile(args: Json): Promise<Json> {
  const filePath = requireString(args.path, "path");
  const content = readFileSync(filePath);
  const fileName = filePath.split("/").pop()!;
  const contentType = inferContentType(fileName);

  const result = await apiRequest<Json>("POST", "/publish", {
    files: [{
      path: fileName,
      content: content.toString("base64"),
      contentType,
      encoding: "base64",
    }],
    title: typeof args.title === "string" ? args.title : undefined,
    template: typeof args.template === "string" ? args.template : undefined,
  });

  sessionSites.push({
    slug: result.slug as string,
    claimToken: result.claimToken as string,
    url: result.url as string,
    createdAt: new Date().toISOString(),
  });

  return result;
}

async function publishSite(args: Json): Promise<Json> {
  const dirPath = requireString(args.path, "path");
  const files = walkDir(dirPath);

  if (files.length === 0) {
    throw new Error("Directory is empty");
  }

  const fileEntries = files.map((f) => ({
    path: f.relativePath,
    content: readFileSync(f.absolutePath).toString("base64"),
    contentType: inferContentType(f.relativePath),
    encoding: "base64" as const,
  }));

  const result = await apiRequest<Json>("POST", "/publish", {
    files: fileEntries,
    title: typeof args.title === "string" ? args.title : undefined,
    template: typeof args.template === "string" ? args.template : undefined,
  });

  sessionSites.push({
    slug: result.slug as string,
    claimToken: result.claimToken as string,
    url: result.url as string,
    createdAt: new Date().toISOString(),
  });

  return result;
}

async function deleteSite(args: Json): Promise<Json> {
  const slug = requireString(args.slug, "slug");
  const session = sessionSites.find((s) => s.slug === slug);
  if (!session) {
    throw new Error(`Site "${slug}" not found in session. Can only delete sites published in this session.`);
  }

  const result = await apiRequest<Json>("DELETE", `/sites/${slug}`, undefined, {
    "X-Claim-Token": session.claimToken,
  });

  const idx = sessionSites.findIndex((s) => s.slug === slug);
  if (idx >= 0) sessionSites.splice(idx, 1);

  return result;
}

// ─── Helpers ───

function walkDir(dirPath: string): Array<{ relativePath: string; absolutePath: string; size: number }> {
  const results: Array<{ relativePath: string; absolutePath: string; size: number }> = [];

  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      if (entry.startsWith(".")) continue;
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else if (stat.isFile()) {
        results.push({
          relativePath: relative(dirPath, full),
          absolutePath: full,
          size: stat.size,
        });
      }
    }
  }

  walk(dirPath);
  return results;
}

function inferContentType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const types: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".csv": "text/csv; charset=utf-8",
    ".tsv": "text/tab-separated-values; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".pdf": "application/pdf",
    ".xml": "application/xml",
    ".mmd": "text/x-mermaid; charset=utf-8",
  };
  return types[ext] ?? "application/octet-stream";
}

async function apiRequest<T>(
  method: string,
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  const url = path.startsWith("http") ? path : `${API_URL}${path}`;
  const headers = new Headers();
  if (body !== undefined) headers.set("Content-Type", "application/json");
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) headers.set(k, v);
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const raw = await res.text();
  const data = raw ? safeJson(raw) : {};
  if (!res.ok) {
    throw new Error(`API ${method} ${path}: ${res.status} - ${JSON.stringify(data ?? raw)}`);
  }
  return (data ?? {}) as T;
}

function safeJson(input: string): unknown {
  try { return JSON.parse(input); } catch { return input; }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${field} must be a non-empty string`);
  return value;
}

function successResult(data: Json | { sites: typeof sessionSites }) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

function errorResult(message: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: message }, null, 2) }],
    structuredContent: { success: false, error: message },
  };
}

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
