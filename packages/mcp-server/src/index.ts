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

// API key resolved once at startup. When present, every /publish and /sites/*
// request carries `Authorization: Bearer easl_<key>` so the worker's api-key
// plugin binds the call to the owning account. Required for account-private
// publishing (private:true without a password) and for share-link creation.
// Password-protected publishing still works anonymously (no key needed).
const API_KEY = process.env.EASL_API_KEY?.trim() || undefined;
const USER_AGENT = `@easl/mcp/${version}`;

// Session state: track published sites for list_sites
const sessionSites: Array<{ slug: string; claimToken: string; url: string; createdAt: string }> = [];

const server = new Server(
  { name: "easl", version },
  { capabilities: { tools: {} } },
);

const privacyProps = {
  private: {
    type: "boolean" as const,
    description:
      "Account gate. If true, the page is account-private: viewable only by the owner account and its share links. REQUIRES the server to be logged in (EASL_API_KEY set in the environment); otherwise the publish fails with 401. Independent of `password` — combine the two to require BOTH login AND the password.",
  },
  password: {
    type: "string" as const,
    description:
      "Password gate. Optional caller-supplied password (4-128 chars) that protects the page behind a password prompt. Works anonymously — no account needed and does NOT imply `private`. Combine with `private: true` (and EASL_API_KEY) to require BOTH login AND the password. To have easl pick a strong password for you instead, omit this and set `generatePassword: true`.",
  },
  generatePassword: {
    type: "boolean" as const,
    description:
      "Password gate, server-generated variant. If true (and no explicit `password` is given), easl mints a strong password and returns it ONCE in the response under `password` — store it, there is no recovery. Works anonymously, like `password`. Ignored when `password` is supplied (the explicit value wins).",
  },
};

const toolDefinitions = [
  {
    name: "publish_content",
    description:
      "Publish raw content (Markdown, CSV, HTML, JSON, SVG, Mermaid) as a shareable page. The fastest way — content goes in, URL comes out. Max 256KB. Pass a `password` (or `generatePassword: true` to have easl mint one, returned once) for a password-protected page (anonymous OK), `private: true` for an account-private page (requires the server to be logged in via EASL_API_KEY), or both to stack the two gates.",
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
        ...privacyProps,
      },
      required: ["content", "contentType"],
    },
  },
  {
    name: "publish_file",
    description:
      "Publish a single file from disk — returns a URL to a shareable page. easl auto-detects the file type and renders it with the best viewer. Pass a `password` (or `generatePassword: true` to have easl mint one, returned once) for a password-protected page (anonymous OK), `private: true` for an account-private page (requires the server to be logged in via EASL_API_KEY), or both to stack the two gates.",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "Absolute path to the file" },
        title: { type: "string", description: "Optional title" },
        template: { type: "string", description: "Optional template: minimal, report, dashboard" },
        ...privacyProps,
      },
      required: ["path"],
    },
  },
  {
    name: "publish_site",
    description:
      "Publish a directory of files as a site. If the directory has an index.html, it's served as-is. Otherwise, easl auto-generates navigation. Pass a `password` (or `generatePassword: true` to have easl mint one, returned once) for a password-protected site (anonymous OK), `private: true` for an account-private site (requires the server to be logged in via EASL_API_KEY), or both to stack the two gates.",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: { type: "string", description: "Absolute path to the directory" },
        title: { type: "string", description: "Optional title" },
        template: { type: "string", description: "Optional template" },
        ...privacyProps,
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
  {
    name: "create_share_link",
    description:
      "Create a signed, expiring share link for an account-private easl. Returns an unguessable URL that lets someone without an account view the page until it expires. Owner-only — REQUIRES the server to be logged in (EASL_API_KEY set) and to own the site. If the site is ALSO password-protected, the recipient still needs the password.",
    inputSchema: {
      type: "object" as const,
      properties: {
        slug: { type: "string", description: "Site slug to share" },
        expiresIn: {
          type: "number",
          description: "Link lifetime in seconds (default 7 days, max 30 days)",
        },
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
      case "create_share_link": return successResult(await createShareLink(args));
      default: return errorResult(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }
});

// Two independent, composable privacy gates (private easls v2), mirroring the
// CLI and the worker (publish.ts): `private` is the ACCOUNT gate and is set ONLY
// from the explicit flag (it always requires auth — anonymous `private: true`
// → 401). The PASSWORD gate is passed through independently — password publishing
// works anonymously, with no account needed — and can be requested two ways:
// an explicit `password` string, or `generatePassword: true` to have the server
// mint one and return it once. An explicit `password` wins over `generatePassword`,
// matching the worker. Do NOT derive `private` from a password; that re-introduces
// the v1 coupling.
function extractPrivacy(args: Json): { private?: true; password?: string; generatePassword?: true } {
  const out: { private?: true; password?: string; generatePassword?: true } = {};
  if (args.private === true) out.private = true;
  if (typeof args.password === "string" && args.password.length > 0) out.password = args.password;
  else if (args.generatePassword === true) out.generatePassword = true;
  return out;
}

async function publishContent(args: Json): Promise<Json> {
  const content = requireString(args.content, "content");
  const contentType = requireString(args.contentType, "contentType");

  const result = await apiRequest<Json>("POST", "/publish", {
    content,
    contentType,
    title: typeof args.title === "string" ? args.title : undefined,
    template: typeof args.template === "string" ? args.template : undefined,
    ...extractPrivacy(args),
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
    ...extractPrivacy(args),
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
    ...extractPrivacy(args),
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

async function createShareLink(args: Json): Promise<Json> {
  const slug = requireString(args.slug, "slug");

  if (!API_KEY) {
    throw new Error(
      "Share links require an account. Set EASL_API_KEY in the server environment — get a key by running `easl login` (or `easl login --device` on a headless/remote machine) and copying it from ~/.config/easl/credentials.json.",
    );
  }

  const body: Json = {};
  if (args.expiresIn != null) {
    if (typeof args.expiresIn !== "number" || !Number.isFinite(args.expiresIn) || args.expiresIn <= 0) {
      throw new Error("expiresIn must be a positive number of seconds");
    }
    body.expiresIn = args.expiresIn;
  }

  return apiRequest<Json>("POST", `/sites/${slug}/share-links`, body);
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
  headers.set("User-Agent", USER_AGENT);
  if (body !== undefined) headers.set("Content-Type", "application/json");

  // Attach the resolved API key as `Authorization: Bearer easl_<key>` so the
  // worker's api-key plugin can bind /publish and /sites/* requests to the
  // owning account. Set before extraHeaders so callers can still override it.
  if (API_KEY) headers.set("Authorization", `Bearer ${API_KEY}`);

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
    // A 401 on an authenticated action (e.g. private:true) almost always means no
    // EASL_API_KEY is set — point the agent at how to obtain one.
    if (res.status === 401 && !API_KEY) {
      throw new Error(
        `API ${method} ${path}: 401 — this needs an account. Set EASL_API_KEY in the server environment: run \`easl login\` (or \`easl login --device\` on a headless/remote machine) and copy the key from ~/.config/easl/credentials.json.`,
      );
    }
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
