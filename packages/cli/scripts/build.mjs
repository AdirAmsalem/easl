import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

await build({
  entryPoints: ['src/cli.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  minify: true,
  outfile: 'dist/cli.cjs',
  define: {
    '__PACKAGE_VERSION__': JSON.stringify(pkg.version),
    '__PACKAGE_NAME__': JSON.stringify(pkg.name),
  },
});
