#!/usr/bin/env node
/**
 * MHDTVP.com Channel Extractor
 * Extracts MPD URLs, KIDs, and Decryption Keys from all live channels
 */

const https = require('https');
const http = require('http');

// ── CONFIG ────────────────────────────────────────────────────────────────
const BASE_URL = 'https://mhdtvp.com';
const LOGIN_EMAIL = process.env.MHDTVP_EMAIL || 'heyisig826@nexafilm.com';
const LOGIN_PASS = process.env.MHDTVP_PASSWORD || '1111111111';
const DECRYPTION_KEY = 'SecureKey123!';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const TIMEOUT_MS = 30000;

// ── ALL KNOWN CHANNEL SLUGS / IDS ────────────────────────────────────────
const CHANNELS = [
  { name: 'Live 1',              slug: 'live-1',              id: 58 },
  { name: 'Live 1',              slug: 'live-1',              id: 57 },
  { name: 'Bundesliga 2',        slug: 'bundesliga-2',        id: 56 },
  { name: 'Bundesliga',          slug: 'bundesliga',          id: 55 },
  { name: 'Serie A 2',           slug: 'serie-a-2',           id: 54 },
  { name: 'Serie A',             slug: 'serie-a',             id: 53 },
  { name: 'T Sports',            slug: 't-sports',            id: 52 },
  { name: 'Nagorik TV',          slug: 'nagorik-tv',          id: 51 },
  { name: 'T Sports',            slug: 't-sports',            id: 50 },
  { name: 'Watch Live PSL',      slug: 'watch-live-psl',      id: 49 },
  { name: 'Watch Live PSL',      slug: 'watch-live-psl',      id: 48 },
  { name: 'Watch Live England',  slug: 'watch-live-england',  id: 47 },
  { name: 'Watch Live Spain',    slug: 'watch-live-spain',    id: 46 },
  { name: 'Watch live Germany',  slug: 'watch-live-germany',  id: 44 },
  { name: 'Watch Live PSG 2',    slug: 'watch-live-psg-2',    id: 43 },
  { name: 'Watch Live Arsenal',  slug: 'watch-live-arsenal',  id: 42 },
];

// ── HELPERS ───────────────────────────────────────────────────────────────

/** Simple cookie jar: url → Set-Cookie header value */
const cookieJar = new Map();

function getCookies(url) {
  const host = new URL(url).hostname;
  const cookies = [];
  for (const [k, v] of cookieJar.entries()) {
    if (host.endsWith(k)) cookies.push(v);
  }
  return cookies.length ? cookies.join('; ') : '';
}

function storeCookies(url, setCookieHeaders) {
  const host = new URL(url).hostname;
  if (!setCookieHeaders) return;
  const headers = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
  for (const h of headers) {
    const part = h.split(';')[0];
    const name = part.split('=')[0].trim();
    // Store per domain
    cookieJar.set(host, (cookieJar.get(host) ? cookieJar.get(host) + '; ' : '') + part);
  }
}

function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout: ${url}`)), options.timeout || TIMEOUT_MS);
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const lib = isHttps ? https : http;

    const headers = {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      ...options.headers,
    };

    if (options.referer) headers['Referer'] = options.referer;
    if (options.cookie !== false) {
      const c = options.cookie || getCookies(url);
      if (c) headers['Cookie'] = c;
    }

    const reqOpts = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers,
      rejectUnauthorized: false,
    };

    if (options.body) {
      reqOpts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
      reqOpts.headers['Content-Length'] = Buffer.byteLength(options.body);
    }

    const req = lib.request(reqOpts, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        clearTimeout(timer);
        storeCookies(url, res.headers['set-cookie']);
        const loc = res.headers.location.startsWith('http') ? res.headers.location : `${urlObj.protocol}//${urlObj.hostname}${res.headers.location}`;
        return fetch(loc, { ...options, cookie: false }).then(resolve).catch(reject);
      }

      storeCookies(url, res.headers['set-cookie']);
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        clearTimeout(timer);
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf-8'),
        });
      });
    });

    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    if (options.body) req.write(options.body);
    req.end();
  });
}

/** XOR decrypt: base64 decode → XOR with key */
function xorDecrypt(base64Data, key) {
  const decoded = Buffer.from(base64Data, 'base64');
  const output = Buffer.alloc(decoded.length);
  for (let i = 0; i < decoded.length; i++) {
    output[i] = decoded[i] ^ key.charCodeAt(i % key.length);
  }
  return output.toString('utf-8');
}

/** Extract value from JS: `(const|let|var) varName = 'value'` or `"(value)"` */
function extractJsString(code, varName) {
  const kv = `const|let|var`;
  const reSingle = new RegExp(`(?:${kv})\\s+${varName}\\s*=\\s*'([^']*?)'\\s*;`, 's');
  const reDouble = new RegExp(`(?:${kv})\\s+${varName}\\s*=\\s*"([^"]*?)"\\s*;`, 's');
  const reBacktick = new RegExp(`(?:${kv})\\s+${varName}\\s*=\x60([^\x60]*?)\x60\\s*;`, 's');
  return (code.match(reSingle) || code.match(reDouble) || code.match(reBacktick) || [])[1] || null;
}

/** Sleep helper */
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── MAIN EXTRACTION LOGIC ────────────────────────────────────────────────

async function login() {
  console.log('[*] Logging in...');

  // Use child_process with curl for proper HTTP/2 + cookie handling
  const { execSync } = require('child_process');
  const tmpCookie = '/tmp/mhdtvp_cookies.txt';

  try {
    // Step 1: GET login page + capture cookies
    execSync(
      `curl -s -c "${tmpCookie}" -o /dev/null ` +
      `-H "User-Agent: ${USER_AGENT}" ` +
      `"${BASE_URL}/login"`,
      { stdio: 'pipe' }
    );

    // Step 2: Extract CSRF _token
    const pageHtml = execSync(
      `curl -s -b "${tmpCookie}" ` +
      `-H "User-Agent: ${USER_AGENT}" ` +
      `"${BASE_URL}/login"`,
      { encoding: 'utf-8', stdio: 'pipe' }
    );
    const csrfMatch = pageHtml.match(/name="_token"\s+[^>]*value="([^"]+)"/);
    if (!csrfMatch) {
      console.log('[-] CSRF token not found');
      return false;
    }
    const csrfToken = csrfMatch[1];
    console.log(`[*] Got CSRF token: ${csrfToken.substring(0, 12)}...`);

    // Step 3: POST login with cookies + CSRF + Origin header
    const loginResult = execSync(
      `curl -s -b "${tmpCookie}" -c "${tmpCookie}" ` +
      `-o /dev/null -w "%{http_code}:%{redirect_url}" ` +
      `-H "User-Agent: ${USER_AGENT}" ` +
      `-H "Referer: ${BASE_URL}/login" ` +
      `-H "Origin: ${BASE_URL}" ` +
      `-H "Content-Type: application/x-www-form-urlencoded" ` +
      `-d "_token=${encodeURIComponent(csrfToken)}&email=${encodeURIComponent(LOGIN_EMAIL)}&password=${encodeURIComponent(LOGIN_PASS)}" ` +
      `"${BASE_URL}/login"`,
      { encoding: 'utf-8', stdio: 'pipe', timeout: 15000 }
    );

    const [status, redirect] = loginResult.split(':');
    if (status === '302' || redirect.includes('dashboard')) {
      console.log('[+] Login successful');

      // Load cookies into our cookie jar for subsequent fetch() calls
      const cookieContent = require('fs').readFileSync(tmpCookie, 'utf-8');
      for (const line of cookieContent.split('\n')) {
        const parts = line.split('\t');
        if (parts.length >= 7 && parts[0] !== '#') {
          const domain = parts[0];
          const name = parts[5];
          const value = parts[6];
          if (name && value) {
            cookieJar.set(domain, (cookieJar.get(domain) ? cookieJar.get(domain) + '; ' : '') + `${name}=${value}`);
          }
        }
      }
      return true;
    }

    console.log(`[-] Login failed (status ${status})`);
    return false;
  } catch (e) {
    console.log(`[-] Login error: ${e.message}`);
    return false;
  }
}

/** Extract iframe URL from watch page */
function extractIframeUrl(html) {
  // Match bsports player
  const m1 = html.match(/iframe[^>]*src=["']([^"']*bsports\.moviesflixter\.com[^"']*)["']/i);
  if (m1) return m1[1];

  // Match any iframe with a player URL
  const m2 = html.match(/iframe[^>]*src=["']([^"']*(?:player|play|live|stream)[^"']*)["']/i);
  if (m2) return m2[1];

  // Match any iframe at all
  const m3 = html.match(/iframe[^>]*src=["']([^"']+)["']/i);
  if (m3) return m3[1];

  return null;
}

/** Try to extract stream URL from iframe URL (for non-BSports players) */
function extractStreamFromIframe(iframeUrl) {
  try {
    const u = new URL(iframeUrl);
    const urlParam = u.searchParams.get('url');
    if (urlParam) return { stream_url: urlParam, stream_type: 'HLS/M3U8' };
  } catch {}
  return null;
}

/** Decrypt and extract MPD, KID, Key from Bokul Sports iframe page */
async function extractBokulSportsData(iframeUrl) {
  try {
    // Use curl for HTTP/2 support (server blocks HTTP/1.1)
    const { execSync } = require('child_process');
    let html;
    try {
      html = execSync(
        `curl -s ` +
        `-H "User-Agent: ${USER_AGENT}" ` +
        `-H "Referer: ${BASE_URL}" ` +
        `'${iframeUrl}'`,
        { encoding: 'utf-8', stdio: 'pipe', timeout: 15000, maxBuffer: 10 * 1024 * 1024 }
      );
    } catch (e) {
      console.log(`\n    [!] curl error: ${e.message}`);
      return null;
    }

    if (!html || html.includes('Access Denied')) {
      console.log(`\n    [!] Got Access Denied or empty page (${html ? html.length : 0} bytes)`);
      return null;
    }

    // Check if it's the Bokul Sports player
    if (!html.includes('decryptionKey') && !html.includes('xorDecrypt') && !html.includes('encrypted')) {
      return null;
    }

    // Extract the decryption key (may be different per channel but usually same)
    const dKey = extractJsString(html, 'decryptionKey') || DECRYPTION_KEY;

    // Extract the encrypted payload
    const encrypted = extractJsString(html, 'encrypted');
    if (!encrypted) {
      console.log('    [!] No encrypted payload found');
      return null;
    }

    // Decrypt
    const decrypted = xorDecrypt(encrypted, dKey);

    // Extract MPD URL, KID, Key from decrypted JS
    const mpdUrl = extractJsString(decrypted, 'mpdUrl');
    const kid = extractJsString(decrypted, 'kid');
    const key = extractJsString(decrypted, 'key');

    if (mpdUrl) {
      return { mpd_url: mpdUrl, kid: kid || '0', key: key || '0' };
    }

    return null;
  } catch (e) {
    console.log(`    [!] Error fetching iframe: ${e.message}`);
    return null;
  }
}

/** Auto-discover new channels from the livetv page */
async function discoverChannels() {
  console.log('[*] Discovering channels from livetv page...');
  const discovered = [];

  for (let page = 1; page <= 3; page++) {
    const res = await fetch(`${BASE_URL}/livetv?page=${page}`, { referer: BASE_URL });
    if (res.statusCode !== 200) break;

    // Extract channel links
    const regex = /href=["'](\/livetv\/watch\/([^"']+))["'][^>]*title=["']([^"']+)["']/gi;
    let match;
    const seen = new Set();
    while ((match = regex.exec(res.body)) !== null) {
      const fullSlug = match[2]; // e.g. "live-1/58"
      const title = match[3];
      const parts = fullSlug.split('/');
      const slug = parts[0];
      const id = parseInt(parts[1]);
      const key = `${slug}-${id}`;
      if (!seen.has(key)) {
        seen.add(key);
        discovered.push({ name: title, slug, id });
      }
    }
    await sleep(300);
  }

  console.log(`[+] Discovered ${discovered.length} channels`);
  return discovered;
}

// ── RUN ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('========================================');
  console.log(' MHDTVP.com Channel Extractor');
  console.log('========================================\n');

  // Login
  if (!(await login())) {
    console.log('[-] Aborting: login failed');
    process.exit(1);
  }
  await sleep(500);

  // Optionally discover channels
  let channels = CHANNELS;
  if (process.argv.includes('--discover')) {
    const discovered = await discoverChannels();
    if (discovered.length > 0) {
      // Merge: prefer discovered, keep manual ones not found
      const discoveredIds = new Set(discovered.map(c => `${c.slug}-${c.id}`));
      for (const c of CHANNELS) {
        if (!discoveredIds.has(`${c.slug}-${c.id}`)) discovered.push(c);
      }
      channels = discovered;
    }
  }

  console.log(`\n[*] Processing ${channels.length} channels...\n`);

  const results = [];

  for (let i = 0; i < channels.length; i++) {
    const ch = channels[i];
    const tag = `#${i + 1} ${ch.name} (id=${ch.id})`;
    process.stdout.write(`  ${tag} ... `);

    const entry = {
      name: ch.name,
      slug: ch.slug,
      id: ch.id,
      watch_url: `${BASE_URL}/livetv/watch/${ch.slug}/${ch.id}`,
      iframe_url: null,
      mpd_url: null,
      kid: null,
      key: null,
      stream_url: null,
      stream_type: null,
    };

    try {
      // Step 1: Fetch watch page
      const watchRes = await fetch(entry.watch_url, {
        referer: `${BASE_URL}/livetv`,
        timeout: 15000,
      });

      if (watchRes.statusCode !== 200) {
        console.log(`FAILED (HTTP ${watchRes.statusCode})`);
        entry.error = `HTTP ${watchRes.statusCode}`;
        results.push(entry);
        await sleep(500);
        continue;
      }

      // Step 2: Extract iframe URL
      const iframeUrl = extractIframeUrl(watchRes.body);
      if (!iframeUrl) {
        console.log('FAILED (no iframe)');
        entry.error = 'No iframe found';
        results.push(entry);
        await sleep(500);
        continue;
      }

      entry.iframe_url = iframeUrl;

      // Step 3: Check if it's a Bokul Sports player
      if (iframeUrl.includes('bsports.moviesflixter.com')) {
        const data = await extractBokulSportsData(iframeUrl);
        if (data) {
          entry.mpd_url = data.mpd_url;
          entry.kid = data.kid;
          entry.key = data.key;
          entry.stream_type = 'DASH/MPD (ClearKey)';
          console.log(`OK  [MPD+Key]`);
        } else {
          console.log('PARTIAL (iframe found, decryption failed)');
          entry.error = 'Decryption failed';
        }
      } else {
        // Non-BSports player — try to get stream URL
        const streamInfo = extractStreamFromIframe(iframeUrl);
        if (streamInfo) {
          entry.stream_url = streamInfo.stream_url;
          entry.stream_type = streamInfo.stream_type;
          console.log(`OK  [${streamInfo.stream_type}]`);
        } else {
          entry.stream_type = 'External iframe';
          console.log(`OK  [External: ${new URL(iframeUrl).hostname}]`);
        }
      }
    } catch (e) {
      console.log(`ERROR: ${e.message}`);
      entry.error = e.message;
    }

    results.push(entry);
    await sleep(800); // Rate limit
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  const withMpd = results.filter(r => r.mpd_url);
  const withStream = results.filter(r => r.stream_url);
  const withIframe = results.filter(r => r.iframe_url && !r.mpd_url && !r.stream_url);
  const failed = results.filter(r => !r.iframe_url);

  console.log('\n========================================');
  console.log(' SUMMARY');
  console.log('========================================');
  console.log(`  Total channels:     ${results.length}`);
  console.log(`  DASH/MPD+Keys:      ${withMpd.length}`);
  console.log(`  HLS/Stream URL:     ${withStream.length}`);
  console.log(`  External iframe:    ${withIframe.length}`);
  console.log(`  Failed:             ${failed.length}`);
  console.log('========================================\n');

  // Write JSON
  const jsonPath = process.env.OUTPUT_JSON || 'channels.json';
  const fs = require('fs');
  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));
  console.log(`[+] Saved JSON → ${jsonPath}`);

  return results;
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});

// Export for use as module
module.exports = { main, xorDecrypt, DECRYPTION_KEY };
