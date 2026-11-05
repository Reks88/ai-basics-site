// Regression test for infra/clean-urls.js — run before deploying the function:
//
//   node infra/test-clean-urls.mjs
//
// The function runs at CloudFront's edge on every single request, so a bug
// here breaks the whole site. Worth the 11 assertions.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, 'clean-urls.js'), 'utf8');
const handler = new Function(src + '; return handler;')();

const cases = [
  // extensionless paths get .html
  ['/glossary',      '/glossary.html'],
  ['/chapter3',      '/chapter3.html'],
  ['/quiz',          '/quiz.html'],
  // directory-style paths get index.html
  ['/',              '/index.html'],
  ['/some/dir/',     '/some/dir/index.html'],
  // real files pass through untouched
  ['/og-cover.png',  '/og-cover.png'],
  ['/sitemap.xml',   '/sitemap.xml'],
  ['/favicon.ico',   '/favicon.ico'],
  ['/robots.txt',    '/robots.txt'],
  ['/chapter3.html', '/chapter3.html'],
  // a dot earlier in the path must not suppress the rewrite
  ['/v1.2/intro',    '/v1.2/intro.html'],
];

let failed = 0;
for (const [uri, want] of cases) {
  const got = handler({ request: { uri } }).uri;
  const ok = got === want;
  if (!ok) failed++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${uri.padEnd(18)} -> ${got}` +
              (ok ? '' : `  (wanted ${want})`));
}

console.log(failed ? `\n${failed} of ${cases.length} failed`
                   : `\n${cases.length} cases passed`);
process.exit(failed ? 1 : 0);
