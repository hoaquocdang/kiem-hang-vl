from __future__ import annotations

import csv
import re
import time
from io import StringIO
from urllib.error import URLError
from urllib.request import urlopen

GOOGLE_SHEET_ID = "1i8EWIOKZDQq9wL7I3uYXMrX-gCED6mJfU7nWbCsT8IA"
COLOR_SHEET_GID = "209884490"
TKCT_SHEET_GID = "2128017473"
CACHE_TTL = 3600
NETWORK_TIMEOUT = 5
NEGATIVE_CACHE_TTL = 60

_cache: dict[str, tuple[float, list[dict]]] = {}
_color_map_cache: tuple[float, dict[int, list[dict]]] | None = None
_product_map_cache: tuple[float, dict[int, list[dict]]] | None = None
_negative_cache: dict[str, float] = {}


def _sheet_csv_url(gid: str) -> str:
    return f"https://docs.google.com/spreadsheets/d/{GOOGLE_SHEET_ID}/export?format=csv&gid={gid}"


def _parse_csv(text: str) -> list[dict]:
    reader = csv.DictReader(StringIO(text))
    return [dict(row) for row in reader]


def fetch_sheet_csv(gid: str) -> list[dict]:
    now = time.time()
    cached = _cache.get(gid)
    if cached and (now - cached[0]) < CACHE_TTL:
        return cached[1]

    last_failure = _negative_cache.get(gid)
    if last_failure and (now - last_failure) < NEGATIVE_CACHE_TTL:
        return cached[1] if cached else []

    url = _sheet_csv_url(gid)
    try:
        with urlopen(url, timeout=NETWORK_TIMEOUT) as response:
            raw = response.read().decode("utf-8-sig")
    except (OSError, URLError, TimeoutError):
        _negative_cache[gid] = now
        return cached[1] if cached else []
    rows = _parse_csv(raw)
    _cache[gid] = (now, rows)
    _negative_cache.pop(gid, None)
    return rows


def prefetch_sheets() -> None:
    """Best-effort warm-up. Safe to call from a background thread."""
    try:
        get_color_map()
        get_product_map()
    except Exception:
        pass


def _normalize(text: str) -> str:
    """Lowercase, strip, collapse whitespace for matching."""
    return re.sub(r"\s+", " ", text.strip().lower())


def _token_overlap(query: str, target: str) -> int:
    """Count how many words from query appear in target."""
    query_words = set(query.split())
    target_words = set(target.split())
    return len(query_words & target_words)


def get_color_map() -> dict[int, list[dict]]:
    """Build a color-code → list-of-rows map (one color may have multiple products)."""
    global _color_map_cache
    now = time.time()
    if _color_map_cache and (now - _color_map_cache[0]) < CACHE_TTL:
        return _color_map_cache[1]
    rows = fetch_sheet_csv(COLOR_SHEET_GID)
    result: dict[int, list[dict]] = {}
    for row in rows:
        raw_code = (row.get("Mã màu") or "").strip()
        if not raw_code:
            continue
        try:
            code = int(raw_code)
        except ValueError:
            continue
        entry = {
            "color_group": (row.get("NHÓM MÀU") or "").strip(),
            "color_tone": (row.get("TONE MÀU") or "").strip(),
            "material": (row.get("CHẤT LIỆU") or "").strip(),
            "form": (row.get("FORM") or "").strip(),
            "style": (row.get("KIỂU") or "").strip(),
            "attributes": (row.get("THUỘC TÍNH #") or "").strip(),
            "product_name": (row.get("TÊN HÀNG") or "").strip(),
        }
        result.setdefault(code, []).append(entry)
    _color_map_cache = (now, result)
    return result


def get_product_map() -> dict[int, list[dict]]:
    """Build a color-code → list-of-rows map from the TKCT sheet."""
    global _product_map_cache
    now = time.time()
    if _product_map_cache and (now - _product_map_cache[0]) < CACHE_TTL:
        return _product_map_cache[1]
    rows = fetch_sheet_csv(TKCT_SHEET_GID)
    result: dict[int, list[dict]] = {}
    for row in rows:
        raw_code = (row.get("Mã Màu") or "").strip()
        if not raw_code:
            continue
        try:
            code = int(raw_code)
        except ValueError:
            continue
        entry = {
            "pattern": (row.get("Hoa văn") or "").strip(),
            "material": (row.get("Chất liệu") or "").strip(),
        }
        result.setdefault(code, []).append(entry)
    _product_map_cache = (now, result)
    return result


def _best_match(entries: list[dict], item_product_name: str) -> dict | None:
    """Pick the best matching entry for the given product name.

    Priority:
    1. Exact product name match (case-insensitive, normalized)
    2. Substring match (item name inside sheet name, or vice versa)
    3. Highest word overlap
    4. First entry in the list (fallback)
    """
    if not entries:
        return None
    if len(entries) == 1:
        return entries[0]

    norm_item = _normalize(item_product_name)

    # Priority 1: exact match
    for entry in entries:
        if _normalize(entry.get("product_name", "")) == norm_item:
            return entry

    # Priority 2: substring match
    for entry in entries:
        entry_name = _normalize(entry.get("product_name", ""))
        if not entry_name:
            continue
        if norm_item in entry_name or entry_name in norm_item:
            return entry

    # Priority 3: best word overlap (at least 2 words)
    best = None
    best_score = 0
    for entry in entries:
        entry_name = _normalize(entry.get("product_name", ""))
        if not entry_name:
            continue
        score = _token_overlap(norm_item, entry_name)
        if score > best_score:
            best_score = score
            best = entry
    if best_score >= 2:
        return best

    # Fallback: first entry
    return entries[0]


def lookup_color(color_code: str, product_name: str = "") -> dict:
    try:
        code = int(color_code)
    except (ValueError, TypeError):
        return {}

    color_map = get_color_map()
    if code in color_map:
        entries = color_map[code]
        match = _best_match(entries, product_name)
        if match:
            return match

    # Fallback: TKCT sheet (flat list, no product distinction)
    product_map = get_product_map()
    if code in product_map:
        entries = product_map[code]
        # Try matching by product name if available
        match = _best_match(entries, product_name)
        if match:
            return {
                "color_group": "",
                "color_tone": match.get("pattern", ""),
                "material": match.get("material", ""),
                "form": "",
                "style": "",
                "attributes": "",
                "product_name": "",
            }
        # Take first
        pm = entries[0]
        return {
            "color_group": "",
            "color_tone": pm.get("pattern", ""),
            "material": pm.get("material", ""),
            "form": "",
            "style": "",
            "attributes": "",
            "product_name": "",
        }

    return {}


def enrich_item(item: dict) -> dict:
    color_code = item.get("color", "")
    product = item.get("product_name", "")
    info = lookup_color(color_code, product)
    item["color_name"] = info.get("color_tone", "")
    item["material"] = info.get("material", "") or item.get("material", "")
    item["style"] = info.get("style", "")
    item["form"] = info.get("form", "")
    item["attributes"] = info.get("attributes", "")
    return item
