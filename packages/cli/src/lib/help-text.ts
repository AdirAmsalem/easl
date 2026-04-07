export interface HelpTextOptions {
  context?: string;
  output?: string;
  errorCodes?: string[];
  examples: string[];
}

const GLOBAL_OPTS = `Global options:
  --api-url <url>     API URL (or set EASL_API_URL env var)
  --json              Force JSON output (also auto-enabled when stdout is piped)
  -q, --quiet         Suppress spinners and status output (implies --json)`;

const ERROR_ENVELOPE = `  {"error":{"message":"<message>","code":"<code>"}}`;

export function buildHelpText(opts: HelpTextOptions): string {
  const parts: string[] = [];
  if (opts.context != null) {
    parts.push(opts.context);
  }
  parts.push(GLOBAL_OPTS);
  if (opts.output != null) {
    parts.push(`Output (--json or piped):\n${opts.output}`);
  }
  if (opts.errorCodes != null) {
    parts.push(
      `Errors (exit code 1):\n${ERROR_ENVELOPE}\n  Codes: ${opts.errorCodes.join(' | ')}`,
    );
  }
  parts.push(`Examples:\n${opts.examples.map((e) => `  $ ${e}`).join('\n')}`);
  return `\n${parts.join('\n\n')}`;
}
