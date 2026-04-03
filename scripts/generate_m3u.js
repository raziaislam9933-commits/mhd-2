#!/usr/bin/env node
/**
 * M3U Playlist Generator for MHDTVP extracted channels
 *
 * Usage:  node generate_m3u.mjs <input-json> <output-m3u>
 *
 * The generated M3U includes:
 *   - DASH/MPD channels with #KID and #KEY tags for ClearKey DRM
 *   - HLS/M3U8 channels with direct stream URLs
 *   - External iframe channels with their watch page URL as fallback
 */

import { readFileSync, writeFileSync } from 'fs';

const inputJson = process.argv[2];
const outputM3u = process.argv[3];

if (!inputJson || !outputM3u) {
  console.error('Usage: node generate_m3u.mjs <input-json> <output-m3u>');
  process.exit(1);
}

const channels = JSON.parse(readFileSync(inputJson, 'utf-8'));

const lines = ['#EXTM3U'];

for (const ch of channels) {
  lines.push('');

  if (ch.mpd_url) {
    // DASH/MPD channel with optional ClearKey DRM
    lines.push(`#EXTINF:-1 group-title="MHDTV Live",${ch.name}`);
    if (ch.kid && ch.key && ch.kid !== '0' && ch.key !== '0') {
      lines.push(`#KID:${ch.kid}`);
      lines.push(`#KEY:${ch.key}`);
    }
    lines.push(ch.mpd_url);
  } else if (ch.stream_url) {
    // HLS / direct stream URL
    lines.push(`#EXTINF:-1 group-title="MHDTV Live",${ch.name}`);
    lines.push(ch.stream_url);
  } else if (ch.iframe_url) {
    // External iframe — use watch page URL as fallback
    lines.push(`#EXTINF:-1 group-title="MHDTV Live",${ch.name}`);
    lines.push(ch.watch_url || ch.iframe_url);
  } else {
    // Channel with no usable URL
    lines.push(`#EXTINF:-1 group-title="MHDTV Live",${ch.name} (unavailable)`);
    lines.push(ch.watch_url || '# no stream available');
  }
}

lines.push('');

writeFileSync(outputM3u, lines.join('\n'));

// ── Summary ──────────────────────────────────────────────────
const dash  = channels.filter(c => c.mpd_url).length;
const hls   = channels.filter(c => c.stream_url && !c.mpd_url).length;
const ext   = channels.filter(c => c.iframe_url && !c.mpd_url && !c.stream_url).length;
const fail  = channels.filter(c => !c.mpd_url && !c.stream_url && !c.iframe_url).length;

console.log(`[+] M3U saved → ${outputM3u}`);
console.log('');
console.log(`  DASH/MPD (with keys) : ${dash}`);
console.log(`  HLS streams          : ${hls}`);
console.log(`  External iframes     : ${ext}`);
console.log(`  Unavailable          : ${fail}`);
console.log(`  ────────────────────────`);
console.log(`  Total                : ${channels.length}`);
