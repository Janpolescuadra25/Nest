/**
 * Qyra Extension — Build Script
 * Uses esbuild for JS/TS/TSX bundling + tailwindcss CLI for CSS
 */
const esbuild = require('esbuild');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const isWatch = process.argv.includes('--watch');

// ── Setup dist directory structure ─────────────────────────────────────────
for (const dir of ['popup', 'content', 'background', 'public/icons']) {
  fs.mkdirSync(path.join(DIST, dir), { recursive: true });
}

// ── Copy static files ──────────────────────────────────────────────────────
fs.copyFileSync(path.join(ROOT, 'manifest.json'), path.join(DIST, 'manifest.json'));
fs.copyFileSync(path.join(ROOT, 'src', 'popup', 'index.html'), path.join(DIST, 'popup', 'index.html'));
if (!isWatch) {
  const manifestPath = path.join(DIST, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

  manifest.host_permissions = manifest.host_permissions.filter(
    (p) => !p.includes('localhost')
  );

  const csp = manifest.content_security_policy.extension_pages;
  const directives = csp.split(';').map((d) => d.trim());
  const connectIdx = directives.findIndex((d) => d.startsWith('connect-src'));
  if (connectIdx !== -1) {
    const sources = directives[connectIdx].split(/\s+/).slice(1);
    const filtered = sources.filter((s) => !s.includes('localhost'));
    filtered.push('https://quickbooks.api.intuit.com');
    directives[connectIdx] = 'connect-src ' + filtered.join(' ');
  }
  manifest.content_security_policy.extension_pages = directives.join('; ');

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}
console.log('[Build] Copied manifest.json and popup/index.html');

// ── Copy icons ─────────────────────────────────────────────────────────────
const iconsDir = path.join(ROOT, 'public', 'icons');
if (fs.existsSync(iconsDir)) {
  for (const f of fs.readdirSync(iconsDir)) {
    fs.copyFileSync(path.join(iconsDir, f), path.join(DIST, 'public', 'icons', f));
  }
  console.log('[Build] Copied icons');
}

const sharedConfig = {
  bundle: true,
  platform: 'browser',
  target: 'chrome120',
  sourcemap: false,
  define: {
    'process.env.NODE_ENV': isWatch ? '"development"' : '"production"',
    'process.env.BACKEND_URL': JSON.stringify(process.env.BACKEND_URL ?? 'https://qyra-backend.onrender.com'),
  },
};

async function build() {
  // ── Popup (React app) ────────────────────────────────────────────────────
  await esbuild.build({
    ...sharedConfig,
    entryPoints: [path.join(ROOT, 'src', 'popup', 'Popup.tsx')],
    outfile: path.join(DIST, 'popup', 'popup.js'),
    jsx: 'automatic',
    jsxImportSource: 'react',
  });
  console.log('[Build] popup/popup.js');

  // ── Content script ───────────────────────────────────────────────────────
  await esbuild.build({
    ...sharedConfig,
    entryPoints: [path.join(ROOT, 'src', 'content', 'scanner.ts')],
    outfile: path.join(DIST, 'content', 'scanner.js'),
  });
  console.log('[Build] content/scanner.js');

  // ── SALIDO content script ───────────────────────────────────────────────────
  await esbuild.build({
    ...sharedConfig,
    entryPoints: [path.join(ROOT, 'src', 'content', 'salido-scanner.ts')],
    outfile: path.join(DIST, 'content', 'salido-scanner.js'),
  });
  console.log('[Build] content/salido-scanner.js');
  // ── Oracle content script ───────────────────────────────────────────────────
  await esbuild.build({
    ...sharedConfig,
    entryPoints: [path.join(ROOT, 'src', 'content', 'oracle-scanner.ts')],
    outfile: path.join(DIST, 'content', 'oracle-scanner.js'),
  });
  console.log('[Build] content/oracle-scanner.js');
  // ── Background service worker ────────────────────────────────────────────
  await esbuild.build({
    ...sharedConfig,
    entryPoints: [path.join(ROOT, 'src', 'background', 'service-worker.ts')],
    outfile: path.join(DIST, 'background', 'service-worker.js'),
    format: 'esm',
  });
  console.log('[Build] background/service-worker.js');

  // ── Tailwind CSS ─────────────────────────────────────────────────────────
  execSync(
    `npx tailwindcss -i "${path.join(ROOT, 'src', 'popup', 'popup.css')}" -o "${path.join(DIST, 'popup', 'popup.css')}" --minify`,
    { stdio: 'inherit', cwd: ROOT }
  );
  console.log('[Build] popup/popup.css (Tailwind)');

  console.log('\n✅  Build complete! Load dist/ as unpacked extension in chrome://extensions\n');
}

build().catch((err) => {
  console.error('[Build] Error:', err.message);
  process.exit(1);
});
