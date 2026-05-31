#!/usr/bin/env python3
"""
Scrape current real estate listings from PAP.fr and LeBonCoin.
Input  (stdin): JSON {"lat", "lon", "city", "dept", "postal", "sources": ["pap","lbc"]}
Output (stdout): JSON stats by type
"""

import sys, json, re, math, os
from collections import defaultdict

try:
    from scrapling.fetchers import StealthyFetcher, DynamicFetcher
except ImportError:
    print(json.dumps({"error": "scrapling non installe", "listings": [], "stats": {}}))
    sys.exit(1)


# ── helpers ───────────────────────────────────────────────────────────────────

def percentile(arr, p):
    if not arr: return None
    s = sorted(arr)
    i = (p / 100) * (len(s) - 1)
    lo, hi = int(i), math.ceil(i)
    return s[lo] + (s[hi] - s[lo]) * (i - lo)

def stats(prices):
    if not prices: return None
    s = sorted(prices)
    return {
        "count":  len(prices),
        "median": round(percentile(prices, 50)),
        "mean":   round(sum(prices) / len(prices)),
        "p10":    round(percentile(prices, 10)),
        "p90":    round(percentile(prices, 90)),
    }

def build_stats(listings):
    typo = defaultdict(list)
    for l in listings:
        rooms = l.get("rooms")
        pm2   = l["pm2"]
        ptype = l.get("type", "").lower()
        if "maison" in ptype:
            key = "Maison"
        elif rooms is None:
            key = "NC"
        elif rooms <= 1:
            key = "T1"
        elif rooms == 2:
            key = "T2"
        elif rooms == 3:
            key = "T3"
        elif rooms == 4:
            key = "T4"
        else:
            key = "T5+"
        typo[key].append(pm2)
    return {k: stats(v) for k, v in typo.items() if v}


# ── LeBonCoin ─────────────────────────────────────────────────────────────────

def notify_captcha(page):
    try:
        page.evaluate(
            """() => {
            if (document.getElementById('_dilimo_b')) return;
            const d = document.createElement('div');
            d.id = '_dilimo_b';
            d.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);background:#1a73e8;color:#fff;padding:14px 28px;border-radius:10px;z-index:2147483647;font-size:15px;font-weight:700;box-shadow:0 4px 24px rgba(0,0,0,.4);font-family:system-ui,sans-serif;pointer-events:none;white-space:nowrap';
            d.textContent = 'Dilimo - Resolvez le CAPTCHA pour continuer';
            document.body.appendChild(d);
            }"""
        )
    except Exception:
        pass


def _clean_chrome_locks(user_data_dir: str):
    """Supprime les fichiers de verrou Chrome qui empêchent le redémarrage
    si la session précédente n'a pas été fermée proprement."""
    for name in ("SingletonLock", "SingletonCookie", "SingletonSocket"):
        lock = os.path.join(user_data_dir, name)
        try:
            os.remove(lock)
            sys.stderr.write(f"[LBC] Supprimé lock file : {name}\n")
        except FileNotFoundError:
            pass
        except Exception as e:
            sys.stderr.write(f"[LBC] Impossible de supprimer {name}: {e}\n")


def _kill_dilimo_chrome(user_data_dir: str):
    """Termine uniquement les processus Chrome qui utilisent notre profil Dilimo.
    Ne touche PAS au Chrome normal de l'utilisateur.
    Nécessaire car macOS refuse 2 instances Chrome partageant le bootstrap system."""
    import subprocess, signal, time
    try:
        result = subprocess.run(
            ["pgrep", "-fl", "Google Chrome"],
            capture_output=True, text=True, timeout=5
        )
        killed = 0
        for line in result.stdout.strip().split("\n"):
            if not line.strip():
                continue
            if user_data_dir in line or "lbc_profile" in line:
                try:
                    pid = int(line.split()[0])
                    os.kill(pid, signal.SIGTERM)
                    killed += 1
                    sys.stderr.write(f"[LBC] Terminé Chrome orphelin PID {pid}\n")
                except (ValueError, ProcessLookupError):
                    pass
        if killed:
            time.sleep(1)  # laisser le temps de se fermer
    except Exception as e:
        sys.stderr.write(f"[LBC] _kill_dilimo_chrome: {e}\n")


def _is_user_chrome_running(dilimo_profile: str) -> bool:
    """Détecte si le Chrome de l'utilisateur tourne (hors nos propres processus Dilimo).
    Retourne True si on risque un conflit macOS bootstrap avec real_chrome=True."""
    import subprocess
    try:
        result = subprocess.run(
            ["pgrep", "-fl", "Google Chrome"],
            capture_output=True, text=True, timeout=5
        )
        for line in result.stdout.strip().split("\n"):
            if not line.strip():
                continue
            # Ignorer nos processus Dilimo et les helpers non-browser
            if dilimo_profile in line:
                continue
            if any(x in line for x in ["Helper", "crashpad", "Renderer", "GPU"]):
                continue
            if "Google Chrome" in line and "--remote-debugging" not in line:
                # C'est probablement le Chrome de l'utilisateur
                return True
    except Exception:
        pass
    return False


def scrape_lbc(city_name, dept):
    location_slug = f"{city_name}_{dept}000"
    url = (
        f"https://www.leboncoin.fr/recherche"
        f"?category=9&locations={location_slug}"
        f"&real_estate_type=1,2"
    )

    user_data_dir = os.path.join(os.path.expanduser("~"), ".dilimo", "lbc_profile")
    os.makedirs(user_data_dir, exist_ok=True)

    # 1. Tuer les Chrome orphelins qui utilisent notre profil Dilimo (pas le Chrome utilisateur)
    _kill_dilimo_chrome(user_data_dir)
    # 2. Nettoyer les lock files laissés par une session précédente
    _clean_chrome_locks(user_data_dir)

    # Détecter si le Chrome de l'utilisateur tourne déjà (conflit macOS bootstrap)
    user_chrome_running = _is_user_chrome_running(user_data_dir)
    if user_chrome_running:
        sys.stderr.write("[LBC] Chrome utilisateur détecté — utilisation de Patchright Chromium\n")
    else:
        sys.stderr.write("[LBC] Pas de Chrome en cours — utilisation du vrai Chrome\n")

    sys.stderr.write(f"[LBC] Fetching {url}\n")

    fetch_kwargs = dict(
        headless=False,
        network_idle=False,
        load_dom=True,
        wait_selector="#__NEXT_DATA__",
        wait_selector_state="attached",
        timeout=120000,
        wait=500,
        locale="fr-FR",
        timezone_id="Europe/Paris",
        page_action=notify_captcha,
    )

    if not user_chrome_running:
        # Vrai Chrome : meilleur fingerprint, bypass DataDome
        fetch_kwargs["real_chrome"] = True
        fetch_kwargs["user_data_dir"] = user_data_dir
    else:
        # Patchright Chromium : pas de conflit macOS
        # On utilise quand même le user_data_dir pour les cookies DataDome
        fetch_kwargs["real_chrome"] = False
        fetch_kwargs["user_data_dir"] = user_data_dir

    page = StealthyFetcher.fetch(url, **fetch_kwargs)

    sys.stderr.write(f"[LBC] Status: {page.status}\n")
    if page.status != 200:
        sys.stderr.write("[LBC] Bloqué (DataDome). Résolvez le CAPTCHA si une fenêtre est ouverte.\n")
        return []

    nd = page.find("#__NEXT_DATA__")
    if not nd:
        return []

    try:
        data = json.loads(nd.text)
    except Exception as e:
        sys.stderr.write(f"[LBC] JSON error: {e}\n")
        return []

    ads = data.get("props", {}).get("pageProps", {}).get("searchData", {}).get("ads", [])
    sys.stderr.write(f"[LBC] {len(ads)} ads found\n")

    listings = []
    for ad in ads:
        price_raw = ad.get("price")
        price = price_raw[0] if isinstance(price_raw, list) and price_raw else price_raw

        attrs = {}
        for a in ad.get("attributes", []):
            key = a.get("key", "")
            val = a.get("value_label") or (a.get("values") or [None])[0]
            attrs[key] = val

        # LBC fournit price_per_square_meter directement
        pm2_direct = None
        try:
            v = str(attrs.get("price_per_square_meter") or "").strip()
            if v:
                pm2_direct = int(v)
        except Exception:
            pass

        surface = None
        try:
            sq = str(attrs.get("square") or "").replace("m2", "").replace("m²","").replace(" ", "").strip()
            if sq:
                surface = float(sq)
        except Exception:
            pass

        rooms = None
        try:
            r = str(attrs.get("rooms") or "").split()[0]
            rooms = int(r)
        except Exception:
            pass

        ptype = attrs.get("real_estate_type", "")

        if pm2_direct and 500 < pm2_direct < 20000:
            pm2 = pm2_direct
        elif price and surface and surface > 9 and price > 15000:
            pm2 = round(price / surface)
            if not (500 < pm2 < 20000):
                continue
        else:
            continue

        listings.append({
            "source": "lbc",
            "type":   ptype,
            "rooms":  rooms,
            "surface": surface,
            "price":  price,
            "pm2":    pm2,
        })

    return listings


# ── PAP ───────────────────────────────────────────────────────────────────────

def parse_pap_item(item):
    html = item.html_content or ""
    pm = re.search(r"item-price[^>]*>\s*([\d\.\s]+)\s*€", html)
    sm = re.search(r"(\d+)\s*m²", html)
    rm = re.search(r"(\d+)\s*pièce", html)
    tm = re.search(r"(Appartement|Maison|Studio|Immeuble|Terrain)", html, re.IGNORECASE)
    if not (pm and sm): return None
    try:
        price   = int(pm.group(1).replace(".", "").replace(" ", "").strip())
        surface = int(sm.group(1))
        rooms   = int(rm.group(1)) if rm else None
        ptype   = tm.group(1).capitalize() if tm else ""
        if price < 15000 or surface < 9: return None
        pm2 = round(price / surface)
        if not (500 < pm2 < 20000): return None
        return {"source": "pap", "type": ptype, "rooms": rooms, "surface": surface, "price": price, "pm2": pm2}
    except Exception:
        return None


def get_pap_city_id(city_name, fetcher):
    try:
        url  = f"https://www.pap.fr/json/ac-geo?q={city_name}"
        page = fetcher.fetch(url, timeout=15000)
        raw  = re.search(r"\[.*\]", page.html_content or "", re.DOTALL)
        if raw:
            d = json.loads(raw.group(0))
            if d: return str(d[0]["id"])
    except Exception:
        pass
    return None


def scrape_pap(city_slug, postal, pap_id, fetcher):
    all_listings = []
    for ptype_url in ["appartements", "maisons"]:
        url = f"https://www.pap.fr/annonce/vente-{ptype_url}-{city_slug}-{postal}-g{pap_id}"
        try:
            page  = fetcher.fetch(url, wait_for="networkidle", timeout=25000)
            items = page.find_all('[class*="search-list-item"]')
            rows  = [r for item in items for r in [parse_pap_item(item)] if r]
            if len(rows) >= 10:
                try:
                    p2   = fetcher.fetch(url + "-2", wait_for="networkidle", timeout=20000)
                    i2   = p2.find_all('[class*="search-list-item"]')
                    rows += [r for item in i2 for r in [parse_pap_item(item)] if r]
                except Exception:
                    pass
            all_listings.extend(rows)
        except Exception as e:
            sys.stderr.write(f"[PAP] Error {url}: {e}\n")
    return all_listings


# ── entry point ───────────────────────────────────────────────────────────────

def main():
    try:
        payload = json.loads(sys.stdin.read())
    except Exception:
        print(json.dumps({"error": "JSON input invalide", "listings": [], "stats": {}}))
        sys.exit(1)

    city_raw = payload.get("city", "")
    dept     = payload.get("dept", "")
    postal   = payload.get("postal", "") or f"{dept}000"
    sources  = payload.get("sources", ["lbc", "pap"])

    if not city_raw:
        print(json.dumps({"error": "city manquant", "listings": [], "stats": {}}))
        sys.exit(1)

    import unicodedata
    def slugify(s):
        s = unicodedata.normalize("NFD", s)
        s = "".join(c for c in s if unicodedata.category(c) != "Mn")
        s = s.lower().replace(" ", "-").replace("'", "-").replace("/", "-")
        s = re.sub(r"[^a-z0-9\-]", "", s)
        return re.sub(r"-+", "-", s).strip("-")

    city_slug    = slugify(city_raw)
    all_listings = []

    if "lbc" in sources:
        try:
            lbc = scrape_lbc(city_raw, dept)
            all_listings.extend(lbc)
            sys.stderr.write(f"[LBC] +{len(lbc)} listings\n")
        except Exception as e:
            sys.stderr.write(f"[LBC] Failed: {e}\n")

    if "pap" in sources:
        fetcher = DynamicFetcher()
        sys.stderr.write(f"[PAP] Looking up '{city_raw}'...\n")
        pap_id = get_pap_city_id(city_raw, fetcher)
        if pap_id:
            pap = scrape_pap(city_slug, postal, pap_id, fetcher)
            all_listings.extend(pap)
            sys.stderr.write(f"[PAP] +{len(pap)} listings\n")
        else:
            sys.stderr.write(f"[PAP] City not found\n")

    agg_stats    = build_stats(all_listings)
    all_pm2      = [l["pm2"] for l in all_listings]
    sources_used = list({l["source"] for l in all_listings})

    print(json.dumps({
        "sources":  sources_used,
        "city":     city_raw,
        "dept":     dept,
        "count":    len(all_listings),
        "stats":    agg_stats,
        "global":   stats(all_pm2),
        "listings": all_listings[:80],
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
