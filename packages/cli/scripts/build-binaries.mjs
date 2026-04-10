import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const version = process.env.CLI_VERSION || pkg.version;

const targets = [
  { bun: 'bun-darwin-arm64', name: 'easl-darwin-arm64' },
  { bun: 'bun-darwin-x64', name: 'easl-darwin-x64' },
  { bun: 'bun-linux-x64', name: 'easl-linux-x64' },
  { bun: 'bun-linux-arm64', name: 'easl-linux-arm64' },
];

const outDir = 'dist/bin';
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

for (const target of targets) {
  console.log(`Building ${target.name}...`);

  const outfile = `${outDir}/${target.name}`;

  execSync(
    [
      'bun build src/cli.ts --compile --minify',
      `--define __PACKAGE_VERSION__='"${version}"'`,
      `--define __PACKAGE_NAME__='"@easl/cli"'`,
      `--define __BINARY_BUILD__='true'`,
      `--target ${target.bun}`,
      `--outfile ${outfile}`,
    ].join(' '),
    { stdio: 'inherit' },
  );

  // Create tar.gz — archive contains a single `easl` binary (no platform suffix)
  execSync(
    `tar -czf ${outDir}/${target.name}.tar.gz -C ${outDir} ${target.name}`,
    { stdio: 'inherit' },
  );

  console.log(`  ✓ ${target.name}.tar.gz`);
}

console.log(`\nAll binaries built for v${version}`);
