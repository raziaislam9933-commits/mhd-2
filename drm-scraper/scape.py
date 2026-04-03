#!/usr/bin/env python3
"""MHDVTVP DRM Key Scraper - XOR decrypts Shaka Player JS, extracts ClearKey KID+Key."""

import requests, re, base64, json, sys, time
from datetime import datetime, timezone

XOR_KEY = "SecureKey123!"
BASE_REFERER = "https://mhdtvp.com/"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
MHDVTVP_URL = "https://mhdtvp.com/livetv"

def xor_decrypt(enc_b64, key):
    raw = base64.b64decode(enc_b64)
    return "".join(chr(b ^ ord(key[i % len(key)])) for i, b in enumerate(raw))

def scrape_channels():
    resp = requests.get(MHDVTVP_URL, headers={"User-Agent": UA}, timeout=20, verify=False)
    embeds = re.findall(r'(https://bsports\.moviesflixter\.com/tolive/play\.php\?id=[a-f0-9]+)', resp.text)
    seen, unique = set(), []
    for e in embeds:
        if e not in seen: seen.add(e); unique.append(e)
    return unique

def process_channel(embed_url):
    try:
        resp = requests.get(embed_url, headers={"Referer": BASE_REFERER, "User-Agent": UA}, timeout=15, verify=False)
        if resp.status_code != 200 or len(resp.text) < 1000: return None
        km = re.search(r'decryptionKey\s*=\s*["\']([^"\']+)["\']', resp.text)
        xor = km.group(1) if km else XOR_KEY
        em = re.search(r'let encrypted\s*=\s*["\']([A-Za-z0-9+/=]+)["\']', resp.text)
        if not em: return None
        dec = xor_decrypt(em.group(1), xor)
        kid = re.search(r"const\s+kid\s*=\s*['\"]([a-f0-9]{32})['\"]", dec)
        key = re.search(r"const\s+key\s*=\s*['\"]([a-f0-9]{32})['\"]", dec)
        mpd = re.search(r"const\s+mpdUrl\s*=\s*['\"]([^'\"]+)['\"]", dec)
        if not kid or not key or kid.group(1) == "0": return None
        return {"mpd": mpd.group(1), "key": key.group(1), "keyid": kid.group(1)} if mpd else None
    except: return None

def main():
    print(f"[*] MHDVTVP DRM Scraper - {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')} UTC")
    embeds = scrape_channels()
    if not embeds:
        print("[!] Scrape failed, using fallback list")
        ids = ["682ad8e91af89","682d615ac0547","682d61e1b46d6","682d625b6fd07","682d625b6fd00",
               "682d625b6fcca","68d8e6667a26e","68d8e6667a269","68d8e6667a25c","682adc5bb3d75",
               "69b9b484d9047","69ab2fb9175b9","69b0595b48e1a","68d8ee3e3ae23","69c6cad934e54",
               "682ae12d9c7cd","69b9923a702a4","6994cbaea5243","69a46588a553c","69c79d0c4b09b"]
        embeds = [f"https://bsports.moviesflixter.com/tolive/play.php?id={i}" for i in ids]
    results = []
    for i, e in enumerate(embeds):
        print(f"[{i+1}/{len(embeds)}] {e.split('id=')[-1]}", end=" ")
        ch = process_channel(e)
        if ch:
            results.append(ch); print(f"+ KID={ch['keyid'][:16]}...")
        else:
            print("- skip")
        time.sleep(0.3)
    seen, uniq = set(), []
    for r in results:
        if r["mpd"] not in seen: seen.add(r["mpd"]); uniq.append(r)
    out = {"source": MHDVTVP_URL, "scraped_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "total_extracted": len(uniq), "decryption_method": "ClearKey via Shaka Player (XOR-obfuscated JS)",
           "xor_key": XOR_KEY, "channels": uniq}
    path = sys.argv[1] if len(sys.argv) > 1 else "mhdtvp_keys.json"
    with open(path, "w") as f: json.dump(out, f, indent=2)
    print(f"\n[+] {len(uniq)} channels -> {path}")

if __name__ == "__main__": main()
