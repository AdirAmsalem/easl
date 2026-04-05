/**
 * Seed script: publish the 5 example sites shown in the homepage terminal demo.
 *
 * Usage:
 *   npx tsx packages/worker/scripts/seed-examples.ts
 *
 * Env:
 *   API_BASE  — API base URL (default: https://api.easl.dev)
 */

const API_BASE = process.env.API_BASE ?? "https://api.easl.dev";
const TEN_YEARS = 10 * 365 * 24 * 60 * 60; // seconds

interface Example {
  slug: string;
  title: string;
  fileName: string;
  contentType: string;
  content: string;
}

const examples: Example[] = [
  {
    slug: "warm-dawn",
    title: "Team Roster",
    fileName: "content.csv",
    contentType: "text/csv",
    content: `name,role,team,joined
Alice Chen,Senior Engineer,Platform,2024-01
Bob Martinez,Product Designer,Product,2023-06
Carol Wu,Product Manager,Growth,2025-01
Dave Okafor,Staff Engineer,Infrastructure,2024-03
Elena Petrov,Engineering Manager,Platform,2023-01
Frank Kim,Data Scientist,Growth,2024-07
Grace Liu,Frontend Engineer,Product,2024-02
Hassan Ali,DevOps Engineer,Infrastructure,2023-09
Iris Nakamura,UX Researcher,Product,2024-11
James Brown,Backend Engineer,Platform,2023-04
Kaia Johansson,QA Engineer,Infrastructure,2025-02
Leo Garcia,Technical Writer,Platform,2024-08`,
  },
  {
    slug: "blue-river",
    title: "Q1 2025 Results",
    fileName: "content.md",
    contentType: "text/markdown",
    content: `# Q1 2025 Results

Revenue grew **42% YoY** to **$2.4M**, exceeding guidance by 8 points.

## Key Wins

- **Enterprise:** \`+68%\` — closed 3 six-figure contracts (Acme Corp, Globex, Initech)
- **Self-serve:** \`+31%\` — driven by new API-first onboarding and usage-based pricing

## Regional Breakdown

| Region | Revenue | Growth |
|--------|---------|--------|
| North America | $1.4M | +38% |
| Europe | $620K | +52% |
| APAC | $380K | +41% |

## Highlights

1. **Net revenue retention** hit 135%, up from 118% last quarter
2. **New logo acquisition** — 47 new customers (vs. 29 in Q4)
3. **Churn** dropped to 1.8% monthly (from 2.4%)

## Outlook

Q2 pipeline is 2.3× coverage with strong signal in enterprise. Expect continued acceleration as the platform expansion lands mid-quarter.

---
*Prepared by the Finance team — April 2025*`,
  },
  {
    slug: "swift-peak",
    title: "Metrics Dashboard",
    fileName: "index.html",
    contentType: "text/html",
    content: `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Metrics Dashboard</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0a; color: #e5e5e5; padding: 2rem; }
  .dashboard { max-width: 900px; margin: 0 auto; }
  h1 { font-size: 1.5rem; font-weight: 700; margin-bottom: 0.25rem; }
  .subtitle { color: #737373; font-size: 0.875rem; margin-bottom: 2rem; }
  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
  .kpi { background: #141414; border: 1px solid #262626; border-radius: 12px; padding: 1.25rem; }
  .kpi .label { font-size: 0.75rem; color: #737373; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem; }
  .kpi .value { font-size: 1.75rem; font-weight: 700; }
  .kpi .change { font-size: 0.75rem; margin-top: 0.25rem; }
  .kpi .up { color: #34d399; }
  .kpi .down { color: #f87171; }
  .charts { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
  @media (max-width: 600px) { .charts { grid-template-columns: 1fr; } }
  .chart-card { background: #141414; border: 1px solid #262626; border-radius: 12px; padding: 1.25rem; }
  .chart-card h3 { font-size: 0.875rem; font-weight: 600; margin-bottom: 1rem; }
  .bar-chart { display: flex; align-items: flex-end; gap: 0.5rem; height: 120px; }
  .bar-group { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 0.25rem; height: 100%; justify-content: flex-end; }
  .bar { width: 100%; border-radius: 4px 4px 0 0; background: #60a5fa; min-height: 4px; transition: height 0.3s; }
  .bar-label { font-size: 0.625rem; color: #737373; }
  .donut-container { display: flex; align-items: center; gap: 1.5rem; }
  .donut { width: 100px; height: 100px; border-radius: 50%; background: conic-gradient(#60a5fa 0% 45%, #34d399 45% 72%, #fbbf24 72% 88%, #737373 88% 100%); position: relative; }
  .donut::after { content: ''; position: absolute; inset: 25%; border-radius: 50%; background: #141414; }
  .donut-legend { font-size: 0.75rem; line-height: 2; }
  .donut-legend span { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 0.5rem; vertical-align: middle; }
  .sparkline { display: flex; align-items: flex-end; gap: 2px; height: 60px; margin-top: 0.5rem; }
  .spark-bar { flex: 1; background: #34d399; border-radius: 2px; opacity: 0.7; }
  .chart-full { grid-column: 1 / -1; }
</style>
</head>
<body>
<div class="dashboard">
  <h1>Metrics Dashboard</h1>
  <p class="subtitle">Real-time overview — Q1 2025</p>

  <div class="kpis">
    <div class="kpi">
      <div class="label">Monthly Revenue</div>
      <div class="value">$824K</div>
      <div class="change up">↑ 12% vs last month</div>
    </div>
    <div class="kpi">
      <div class="label">Active Users</div>
      <div class="value">14.2K</div>
      <div class="change up">↑ 8% vs last month</div>
    </div>
    <div class="kpi">
      <div class="label">Avg Response Time</div>
      <div class="value">142ms</div>
      <div class="change up">↓ 18ms improvement</div>
    </div>
    <div class="kpi">
      <div class="label">Error Rate</div>
      <div class="value">0.03%</div>
      <div class="change up">↓ from 0.05%</div>
    </div>
  </div>

  <div class="charts">
    <div class="chart-card">
      <h3>Revenue by Month</h3>
      <div class="bar-chart">
        <div class="bar-group"><div class="bar" style="height:55%"></div><div class="bar-label">Oct</div></div>
        <div class="bar-group"><div class="bar" style="height:62%"></div><div class="bar-label">Nov</div></div>
        <div class="bar-group"><div class="bar" style="height:58%"></div><div class="bar-label">Dec</div></div>
        <div class="bar-group"><div class="bar" style="height:71%"></div><div class="bar-label">Jan</div></div>
        <div class="bar-group"><div class="bar" style="height:78%"></div><div class="bar-label">Feb</div></div>
        <div class="bar-group"><div class="bar" style="height:92%"></div><div class="bar-label">Mar</div></div>
      </div>
    </div>

    <div class="chart-card">
      <h3>Traffic Sources</h3>
      <div class="donut-container">
        <div class="donut"></div>
        <div class="donut-legend">
          <div><span style="background:#60a5fa"></span>Direct — 45%</div>
          <div><span style="background:#34d399"></span>API — 27%</div>
          <div><span style="background:#fbbf24"></span>Referral — 16%</div>
          <div><span style="background:#737373"></span>Other — 12%</div>
        </div>
      </div>
    </div>

    <div class="chart-card chart-full">
      <h3>Daily Active Users (last 30 days)</h3>
      <div class="sparkline">
        <div class="spark-bar" style="height:45%"></div><div class="spark-bar" style="height:52%"></div>
        <div class="spark-bar" style="height:48%"></div><div class="spark-bar" style="height:61%"></div>
        <div class="spark-bar" style="height:55%"></div><div class="spark-bar" style="height:42%"></div>
        <div class="spark-bar" style="height:38%"></div><div class="spark-bar" style="height:58%"></div>
        <div class="spark-bar" style="height:65%"></div><div class="spark-bar" style="height:71%"></div>
        <div class="spark-bar" style="height:68%"></div><div class="spark-bar" style="height:74%"></div>
        <div class="spark-bar" style="height:62%"></div><div class="spark-bar" style="height:58%"></div>
        <div class="spark-bar" style="height:45%"></div><div class="spark-bar" style="height:52%"></div>
        <div class="spark-bar" style="height:67%"></div><div class="spark-bar" style="height:72%"></div>
        <div class="spark-bar" style="height:78%"></div><div class="spark-bar" style="height:82%"></div>
        <div class="spark-bar" style="height:75%"></div><div class="spark-bar" style="height:69%"></div>
        <div class="spark-bar" style="height:55%"></div><div class="spark-bar" style="height:63%"></div>
        <div class="spark-bar" style="height:71%"></div><div class="spark-bar" style="height:85%"></div>
        <div class="spark-bar" style="height:88%"></div><div class="spark-bar" style="height:92%"></div>
        <div class="spark-bar" style="height:87%"></div><div class="spark-bar" style="height:95%"></div>
      </div>
    </div>
  </div>
</div>
</body>
</html>`,
  },
  {
    slug: "cool-leaf",
    title: "User Profile — Alice",
    fileName: "data.json",
    contentType: "application/json",
    content: JSON.stringify(
      {
        user: {
          id: "usr_2k8jf9a1",
          name: "Alice Chen",
          email: "alice@example.com",
          plan: "pro",
          usage: {
            apiCalls: 8420,
            storage: "1.2 GB",
            bandwidth: "4.8 GB",
          },
          active: true,
          createdAt: "2024-01-15T09:30:00Z",
          lastLoginAt: "2025-04-04T14:22:00Z",
        },
        team: {
          id: "team_platform",
          name: "Platform",
          members: 5,
          role: "admin",
        },
        billing: {
          plan: "Pro",
          mrr: 49,
          nextInvoice: "2025-05-01",
          paymentMethod: "visa_4242",
        },
      },
      null,
      2,
    ),
  },
  {
    slug: "red-cloud",
    title: "OAuth Authentication Flow",
    fileName: "image.svg",
    contentType: "image/svg+xml",
    content: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 520" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif">
  <defs>
    <marker id="arrow" viewBox="0 0 10 7" refX="9" refY="3.5" markerWidth="10" markerHeight="7" orient="auto-start-reverse">
      <polygon points="0 0, 10 3.5, 0 7" fill="#60a5fa"/>
    </marker>
  </defs>

  <rect width="800" height="520" rx="12" fill="#0a0a0a"/>

  <text x="400" y="40" text-anchor="middle" fill="#ffffff" font-size="18" font-weight="700">OAuth 2.0 Authorization Code Flow</text>
  <text x="400" y="62" text-anchor="middle" fill="#737373" font-size="12">3 actors · 6 steps</text>

  <!-- Actor boxes -->
  <rect x="40" y="90" width="160" height="50" rx="8" fill="#141414" stroke="#262626"/>
  <text x="120" y="120" text-anchor="middle" fill="#e5e5e5" font-size="14" font-weight="600">User (Browser)</text>

  <rect x="320" y="90" width="160" height="50" rx="8" fill="#141414" stroke="#262626"/>
  <text x="400" y="120" text-anchor="middle" fill="#e5e5e5" font-size="14" font-weight="600">Your App</text>

  <rect x="600" y="90" width="160" height="50" rx="8" fill="#141414" stroke="#262626"/>
  <text x="680" y="120" text-anchor="middle" fill="#e5e5e5" font-size="14" font-weight="600">Auth Server</text>

  <!-- Lifelines -->
  <line x1="120" y1="140" x2="120" y2="480" stroke="#262626" stroke-width="1" stroke-dasharray="4,4"/>
  <line x1="400" y1="140" x2="400" y2="480" stroke="#262626" stroke-width="1" stroke-dasharray="4,4"/>
  <line x1="680" y1="140" x2="680" y2="480" stroke="#262626" stroke-width="1" stroke-dasharray="4,4"/>

  <!-- Step 1 -->
  <rect x="60" y="170" width="20" height="8" rx="4" fill="#60a5fa"/>
  <text x="84" y="178" fill="#60a5fa" font-size="11" font-weight="700">1</text>
  <line x1="120" y1="175" x2="395" y2="175" stroke="#60a5fa" stroke-width="1.5" marker-end="url(#arrow)"/>
  <text x="258" y="168" text-anchor="middle" fill="#a3a3a3" font-size="11">Click "Sign In"</text>

  <!-- Step 2 -->
  <rect x="340" y="220" width="20" height="8" rx="4" fill="#34d399"/>
  <text x="364" y="228" fill="#34d399" font-size="11" font-weight="700">2</text>
  <line x1="400" y1="225" x2="675" y2="225" stroke="#34d399" stroke-width="1.5" marker-end="url(#arrow)"/>
  <text x="538" y="218" text-anchor="middle" fill="#a3a3a3" font-size="11">Redirect to /authorize</text>
  <text x="538" y="234" text-anchor="middle" fill="#525252" font-size="10">client_id + redirect_uri + scope</text>

  <!-- Step 3 -->
  <rect x="620" y="270" width="20" height="8" rx="4" fill="#fbbf24"/>
  <text x="644" y="278" fill="#fbbf24" font-size="11" font-weight="700">3</text>
  <line x1="675" y1="275" x2="125" y2="275" stroke="#fbbf24" stroke-width="1.5" marker-end="url(#arrow)"/>
  <text x="400" y="268" text-anchor="middle" fill="#a3a3a3" font-size="11">Show consent screen</text>

  <!-- Step 4 -->
  <rect x="60" y="320" width="20" height="8" rx="4" fill="#60a5fa"/>
  <text x="84" y="328" fill="#60a5fa" font-size="11" font-weight="700">4</text>
  <line x1="120" y1="325" x2="395" y2="325" stroke="#60a5fa" stroke-width="1.5" marker-end="url(#arrow)"/>
  <text x="258" y="318" text-anchor="middle" fill="#a3a3a3" font-size="11">Redirect with auth code</text>
  <text x="258" y="334" text-anchor="middle" fill="#525252" font-size="10">?code=abc123</text>

  <!-- Step 5 -->
  <rect x="340" y="370" width="20" height="8" rx="4" fill="#34d399"/>
  <text x="364" y="378" fill="#34d399" font-size="11" font-weight="700">5</text>
  <line x1="400" y1="375" x2="675" y2="375" stroke="#34d399" stroke-width="1.5" marker-end="url(#arrow)"/>
  <text x="538" y="368" text-anchor="middle" fill="#a3a3a3" font-size="11">Exchange code for token</text>
  <text x="538" y="384" text-anchor="middle" fill="#525252" font-size="10">POST /token + client_secret</text>

  <!-- Step 6 -->
  <rect x="620" y="420" width="20" height="8" rx="4" fill="#fbbf24"/>
  <text x="644" y="428" fill="#fbbf24" font-size="11" font-weight="700">6</text>
  <line x1="675" y1="425" x2="405" y2="425" stroke="#fbbf24" stroke-width="1.5" marker-end="url(#arrow)"/>
  <text x="538" y="418" text-anchor="middle" fill="#a3a3a3" font-size="11">Return access_token + refresh_token</text>

  <!-- Success -->
  <rect x="310" y="460" width="180" height="30" rx="6" fill="rgba(52,211,153,0.1)" stroke="#34d399" stroke-width="1"/>
  <text x="400" y="480" text-anchor="middle" fill="#34d399" font-size="12" font-weight="600">✓ Authenticated</text>
</svg>`,
  },
];

async function publishMultiStep(ex: Example): Promise<string> {
  const fileSize = new TextEncoder().encode(ex.content).byteLength;

  // Step 1: Create site with custom slug
  const createRes = await fetch(`${API_BASE}/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      slug: ex.slug,
      title: ex.title,
      ttl: TEN_YEARS,
      files: [{ path: ex.fileName, size: fileSize, contentType: ex.contentType }],
    }),
  });

  if (!createRes.ok) {
    const err = await createRes.text();
    throw new Error(`Failed to create ${ex.slug}: ${createRes.status} ${err}`);
  }

  const createData = (await createRes.json()) as {
    slug: string;
    url: string;
    upload: { versionId: string; uploads: Array<{ url: string; headers: Record<string, string> }> };
  };

  // Step 2: Upload content via presigned URL
  const upload = createData.upload.uploads[0];
  const uploadRes = await fetch(upload.url, {
    method: "PUT",
    headers: upload.headers,
    body: ex.content,
  });

  if (!uploadRes.ok) {
    throw new Error(`Failed to upload ${ex.slug}: ${uploadRes.status}`);
  }

  // Step 3: Finalize
  const finalizeRes = await fetch(`${API_BASE}/finalize/${ex.slug}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ versionId: createData.upload.versionId }),
  });

  if (!finalizeRes.ok) {
    const err = await finalizeRes.text();
    throw new Error(`Failed to finalize ${ex.slug}: ${finalizeRes.status} ${err}`);
  }

  return createData.url;
}

async function publishInline(ex: Example): Promise<string> {
  const res = await fetch(`${API_BASE}/publish/inline`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: ex.content,
      contentType: ex.contentType,
      title: ex.title,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to publish inline ${ex.slug}: ${res.status} ${err}`);
  }

  const data = (await res.json()) as { url: string; slug: string };
  return data.url;
}

async function publishExample(ex: Example): Promise<void> {
  try {
    const url = await publishMultiStep(ex);
    console.log(`✓ ${ex.slug} → ${url}`);
  } catch (e) {
    // Multi-step fails locally (no R2 presign secrets) — fall back to inline
    if (process.env.SEED_INLINE) {
      const url = await publishInline(ex);
      console.log(`✓ ${ex.slug} (inline, random slug) → ${url}`);
    } else {
      throw e;
    }
  }
}

async function main() {
  console.log(`Seeding examples to ${API_BASE}...\n`);

  for (const ex of examples) {
    try {
      await publishExample(ex);
    } catch (e) {
      console.error(`✗ ${ex.slug}: ${e instanceof Error ? e.message : e}`);
    }
  }

  console.log("\nDone.");
}

main();
