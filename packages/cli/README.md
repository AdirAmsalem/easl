# @easl/cli

Instant hosting from your terminal. Publish files, directories, or piped content as shareable web pages with interactive viewers.

```bash
easl publish report.md
# => https://calm-river.easl.dev
```

easl auto-detects content types (CSV, Markdown, JSON, HTML, SVG, Mermaid, PDF, images) and renders them with the right viewer — sortable tables, syntax highlighting, collapsible trees, and more.

## Install

```bash
curl -fsSL https://easl.dev/install.sh | sh
```

Or via npm:

```bash
npm install -g @easl/cli
```

## Usage

### Publish a file

```bash
easl publish report.md
easl publish data.csv --title "Q4 Results" --open
easl publish chart.svg --slug my-chart --copy
```

### Publish a directory

```bash
easl publish ./my-site/
```

If the directory has an `index.html`, it's served as-is. Otherwise, easl auto-generates navigation.

### Publish from stdin

```bash
cat data.csv | easl publish --type csv
echo '{"status":"ok"}' | easl publish --type json
```

### Publish inline content

```bash
easl publish --content "# Hello World" --type markdown
```

### Manage sites

```bash
easl list              # List sites published from this machine
easl get <slug>        # Get site metadata
easl delete <slug>     # Delete a site (with confirmation)
easl open <slug>       # Open site in browser
```

## Commands

| Command | Description |
|---------|-------------|
| `publish [path]` | Publish a file, directory, stdin, or inline content |
| `list` / `ls` | List sites published from this machine |
| `get <slug>` | Get site metadata from the API |
| `delete <slug>` / `rm` | Delete a published site (`--yes` to skip confirmation) |
| `open [slug]` | Open a site or easl.dev in your browser |
| `doctor` | Check CLI version, API connectivity, and local config |
| `completion [shell]` | Generate shell completions (bash, zsh, fish) |

## Publish options

| Flag | Description |
|------|-------------|
| `--content <text>` | Inline content to publish (alternative to file path or stdin) |
| `--type <type>` | Content type: `markdown`, `csv`, `html`, `json`, `svg`, `mermaid`, or a MIME type |
| `--title <title>` | Page title |
| `--template <tpl>` | `minimal`, `report`, or `dashboard` |
| `--slug <slug>` | Custom slug (lowercase alphanumeric + hyphens, 3-48 chars) |
| `--ttl <seconds>` | Time to live in seconds (default: 7 days) |
| `--open` | Open in browser after publishing |
| `--copy` | Copy URL to clipboard |

## Global options

| Flag | Description |
|------|-------------|
| `--json` | Force JSON output (auto-enabled when stdout is piped) |
| `-q, --quiet` | Suppress spinners and status output (implies `--json`) |
| `--api-url <url>` | Override API URL (or set `EASL_API_URL` env var) |

## JSON output

When piped or with `--json`, all commands output structured JSON to stdout:

```bash
easl publish report.md --json
# {"url":"...","slug":"...","claimToken":"...","expiresAt":"..."}

easl list --json
# [{"slug":"...","url":"...","createdAt":"..."}]
```

Errors output to stdout with exit code 1:

```json
{"error":{"message":"...","code":"..."}}
```

## Shell completions

```bash
# Auto-install for your shell
easl completion --install

# Or generate manually
eval "$(easl completion bash)"
eval "$(easl completion zsh)"
easl completion fish > ~/.config/fish/completions/easl.fish
```

## Local config

Published sites and their claim tokens are tracked in `~/.config/easl/sites.json`. This enables `easl list` and `easl delete` to work without re-entering tokens. Only sites published from the current machine are tracked.

## Agent usage

easl is designed for AI agents. All commands output structured JSON when piped or with `--json`, making it easy to integrate into agent workflows:

```bash
# Publish and capture the URL
URL=$(easl publish report.md --json | jq -r '.url')

# Publish inline content
easl publish --content "$(generate_report)" --type markdown --json

# Clean up
easl delete my-site --yes --json
```

## License

MIT
