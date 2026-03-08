/**
 * Real-browser integration test for the P-Stream extension.
 *
 * Loads the built extension (build/chrome-mv3-prod) into a headless Chromium
 * via Playwright's persistent-context API, then exercises every page the
 * extension can show:
 *
 *   1. Service worker starts successfully
 *   2. Built manifest is correct (version, permissions, popup, etc.)
 *   3. Popup → SetupScreen (no permission granted yet)
 *   4. Clicking "Continue" opens the PermissionRequest tab
 *   5. PermissionGrant page loads
 *   6. Popup renders without errors after storage is seeded
 *   7. Built JS bundles contain the expected components
 *   8. Background service-worker JS contains the expected handlers
 *   9. Content script contains the expected messaging code
 *  10. No JavaScript errors on any page
 *
 * Usage (assumes the extension is already built):
 *   node tests/extension.test.mjs
 *
 * In CI, run inside xvfb-run:
 *   xvfb-run --auto-servernum --server-args="-screen 0 1280x800x24" \
 *     node tests/extension.test.mjs
 */

import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT       = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXT_PATH   = join(ROOT, 'build', 'chrome-mv3-prod');
const SS_DIR     = join(dirname(fileURLToPath(import.meta.url)), 'screenshots');
mkdirSync(SS_DIR, { recursive: true });

const results  = [];
const jsErrors = [];

function pass(name, detail = '') {
  results.push({ ok: true, name, detail });
  console.log(`  ✅  ${name}${detail ? ' (' + detail + ')' : ''}`);
}
function fail(name, detail = '') {
  results.push({ ok: false, name, detail });
  console.log(`  ❌  ${name}${detail ? ' (' + detail + ')' : ''}`);
}

// ── Launch Chrome with the unpacked extension ─────────────────────────────────
// Extensions require a headed context; use xvfb-run in CI (see CI workflow).
const ctx = await chromium.launchPersistentContext('', {
  headless: false,
  args: [
    `--disable-extensions-except=${EXT_PATH}`,
    `--load-extension=${EXT_PATH}`,
    '--no-sandbox',
    '--disable-dev-shm-usage',
  ],
  // Let playwright resolve the bundled Chromium automatically, unless overridden
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  viewport: { width: 420, height: 650 },
});

// Poll until the extension service worker appears (up to 10s)
let extId = null;
for (let i = 0; i < 40 && !extId; i++) {
  await new Promise(r => setTimeout(r, 250));
  for (const sw of ctx.serviceWorkers()) {
    const m = sw.url().match(/chrome-extension:\/\/([^/]+)/);
    if (m) { extId = m[1]; break; }
  }
}

// ── 1. Service worker ─────────────────────────────────────────────────────────
console.log('\n── Service worker ───────────────────────────');
for (const sw of ctx.serviceWorkers()) console.log('  ', sw.url());
if (extId) pass('service-worker-started', extId);
else       { fail('service-worker-started', 'no service worker found after 10s'); await ctx.close(); process.exit(1); }

// ── 2. Manifest ───────────────────────────────────────────────────────────────
console.log('\n── Manifest ─────────────────────────────────');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const mf  = JSON.parse(readFileSync(join(EXT_PATH, 'manifest.json'), 'utf8'));

mf.version === pkg.version                            ? pass('manifest-version',           mf.version)  : fail('manifest-version',        `got "${mf.version}", want "${pkg.version}"`);
mf.manifest_version === 3                             ? pass('manifest-mv3')                            : fail('manifest-mv3');
Boolean(mf.background?.service_worker)                ? pass('manifest-service-worker')                 : fail('manifest-service-worker');
mf.permissions?.includes('declarativeNetRequest')     ? pass('manifest-dnr-permission')                : fail('manifest-dnr-permission');
mf.permissions?.includes('storage')                   ? pass('manifest-storage-permission')            : fail('manifest-storage-permission');
mf.permissions?.includes('cookies')                   ? pass('manifest-cookies-permission')            : fail('manifest-cookies-permission');
mf.optional_host_permissions?.includes('<all_urls>')  ? pass('manifest-optional-all-urls')             : fail('manifest-optional-all-urls');
mf.content_scripts?.length > 0                        ? pass('manifest-content-script')                : fail('manifest-content-script');
mf.action?.default_popup === 'popup.html'             ? pass('manifest-popup-action')                  : fail('manifest-popup-action');

// ── helper: open an extension page and attach error listeners ─────────────────
async function openExtPage(path, label) {
  const p = await ctx.newPage();
  p.on('pageerror', e => jsErrors.push(`[${label}] ${e.message}`));
  p.on('console',   m => { if (m.type() === 'error') jsErrors.push(`[${label} console] ${m.text()}`); });
  await p.goto(`chrome-extension://${extId}/${path}`);
  await p.waitForLoadState('networkidle');
  // Wait for React to mount something visible in the body
  await p.waitForSelector('body > *', { timeout: 5000 }).catch(() => {});
  return p;
}

// ── 3. Popup — SetupScreen (no permission) ────────────────────────────────────
console.log('\n── Popup (setup screen) ─────────────────────');
const popup1 = await openExtPage('popup.html', 'popup1');
await popup1.screenshot({ path: join(SS_DIR, '01-popup-setup-screen.png'), fullPage: true });

const p1text = await popup1.textContent('body');
p1text.includes("Let's get things configured") ? pass('setup-screen-heading')  : fail('setup-screen-heading',  p1text.slice(0, 80));
p1text.includes('Continue')                    ? pass('setup-screen-continue') : fail('setup-screen-continue', p1text.slice(0, 80));

const topLabel = await popup1.$('.top-right-label');
const topVer   = topLabel ? (await topLabel.textContent()) : '';
topVer.includes(`v${pkg.version}`) ? pass('version-label', topVer) : fail('version-label', `"${topVer}"`);

// ── 4. "Continue" opens PermissionRequest tab ─────────────────────────────────
console.log('\n── Continue button → PermissionRequest tab ──');
const btn          = await popup1.$('button');
const newPageProm  = ctx.waitForEvent('page', { timeout: 7000 }).catch(() => null);
// The SetupScreen calls window.close() after opening the new tab — the click
// itself succeeds but the popup context closes immediately afterwards.
const clickErr = await btn.click().then(() => null, e => e);
if (clickErr && !clickErr.message.includes('closed')) console.warn('  ⚠ click error:', clickErr.message);
const permTab      = await newPageProm;

if (permTab) {
  permTab.on('pageerror', e => jsErrors.push(`[permTab] ${e.message}`));
  await permTab.waitForLoadState('networkidle').catch(() => {});
  await permTab.waitForSelector('body > *', { timeout: 5000 }).catch(() => {});
  await permTab.screenshot({ path: join(SS_DIR, '02-permission-request-tab.png'), fullPage: true });
  const ptxt = await permTab.textContent('body');
  ptxt.includes('browser permissions')              ? pass('continue-opens-perm-tab')        : fail('continue-opens-perm-tab',       ptxt.slice(0, 80));
  ptxt.includes('Grant Permission')                 ? pass('perm-tab-grant-button')           : fail('perm-tab-grant-button');
  ptxt.includes('Read source code')                 ? pass('perm-tab-github-card')            : fail('perm-tab-github-card');
  ptxt.includes('Network Requests') ||
    ptxt.includes('declarativeNetRequest')          ? pass('perm-tab-network-card')           : fail('perm-tab-network-card');
  ptxt.includes('cookies') || ptxt.includes('Cookies') ? pass('perm-tab-cookies-card')       : fail('perm-tab-cookies-card');
} else {
  fail('continue-opens-perm-tab', 'no new tab was opened');
}

// ── 5. PermissionGrant page ───────────────────────────────────────────────────
console.log('\n── PermissionGrant page ─────────────────────');
const grantPage = await openExtPage('tabs/PermissionGrant.html', 'grant');
await grantPage.screenshot({ path: join(SS_DIR, '03-permission-grant.png'), fullPage: true });
const gtxt      = await grantPage.textContent('body');
gtxt.length > 10 ? pass('perm-grant-page-loads', gtxt.replace(/\s+/g,' ').slice(0, 80))
                 : fail('perm-grant-page-loads', 'empty body');

// ── 6. Popup with storage seeded ──────────────────────────────────────────────
console.log('\n── Popup (storage seeded) ───────────────────');
const popup2 = await openExtPage('popup.html', 'popup2');
await popup2.evaluate(async () => {
  await new Promise(r => chrome.storage.local.set({ domainWhitelist: [] }, r));
});
await popup2.reload();
await popup2.waitForLoadState('networkidle');
await popup2.waitForSelector('body > *', { timeout: 5000 }).catch(() => {});
await popup2.screenshot({ path: join(SS_DIR, '04-popup-storage-seeded.png'), fullPage: true });
const p2text = await popup2.textContent('body');
p2text.length > 5 ? pass('popup-renders-after-storage-seed', p2text.replace(/\s+/g,' ').slice(0, 80))
                  : fail('popup-renders-after-storage-seed', 'empty body');

// ── 7. Built popup JS contains expected components ────────────────────────────
console.log('\n── Built JS (popup bundle) ──────────────────');
const popupBundles = readFileSync(join(EXT_PATH, 'popup.html'), 'utf8')
  .match(/popup\.[a-f0-9]+\.js/g) || [];
let popupJs = '';
for (const f of popupBundles) {
  popupJs += readFileSync(join(EXT_PATH, f), 'utf8');
}
popupJs.includes('github-link')        ? pass('popup-js-github-link-class')   : fail('popup-js-github-link-class');
popupJs.includes('GitHub')             ? pass('popup-js-github-text')         : fail('popup-js-github-text');
popupJs.includes('p-stream/extension') ? pass('popup-js-github-href')         : fail('popup-js-github-href');
popupJs.includes('bottom-label')       ? pass('popup-js-bottom-label-class')  : fail('popup-js-bottom-label-class');
popupJs.includes('useVersion') || popupJs.includes(pkg.version)
                                       ? pass('popup-js-version-hook')        : fail('popup-js-version-hook');

// ── 8. Background service-worker JS ──────────────────────────────────────────
console.log('\n── Background service worker JS ─────────────');
const bgJs = readFileSync(join(EXT_PATH, 'static', 'background', 'index.js'), 'utf8');
bgJs.includes('makeRequest') || bgJs.includes('prepareStream')
  ? pass('bg-message-handlers')         : fail('bg-message-handlers');
bgJs.includes('updateDynamicRules') || bgJs.includes('declarativeNetRequest')
  ? pass('bg-declarative-net-request')  : fail('bg-declarative-net-request');
bgJs.includes('tabs.create') || bgJs.includes('openPage') || bgJs.includes('tabs')
  ? pass('bg-tabs-logic')               : fail('bg-tabs-logic');

// ── 9. Content script ─────────────────────────────────────────────────────────
console.log('\n── Content script ───────────────────────────');
const csFiles = (mf.content_scripts ?? []).flatMap(cs => cs.js ?? []);
let csJs = '';
for (const f of csFiles) {
  csJs += readFileSync(join(EXT_PATH, f), 'utf8');
}
csJs.includes('sendMessage') || csJs.includes('runtime')
  ? pass('content-script-messaging')    : fail('content-script-messaging');

// ── 10. No JS errors ──────────────────────────────────────────────────────────
console.log('\n── JS errors ────────────────────────────────');
jsErrors.length === 0
  ? pass('no-js-errors')
  : fail('no-js-errors', jsErrors.slice(0, 3).join(' | '));

// ── Print summary ─────────────────────────────────────────────────────────────
const passed = results.filter(r => r.ok).length;
const total  = results.length;
console.log('\n══════════════════════════════════════════════');
console.log(`  RESULT: ${passed}/${total} tests passed`);
if (passed < total) {
  console.log('\n  FAILURES:');
  results.filter(r => !r.ok).forEach(r => console.log(`    ❌  ${r.name}${r.detail ? ' — ' + r.detail : ''}`));
}
console.log('══════════════════════════════════════════════\n');
if (jsErrors.length) { console.log('JS errors:\n'); jsErrors.forEach(e => console.log('  ', e)); }

await ctx.close();
process.exit(passed === total ? 0 : 1);
