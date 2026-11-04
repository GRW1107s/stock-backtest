#!/usr/bin/env python3
"""Acquire real 6976.T five-minute historical candles (~60 calendar days) via Yahoo chart API.
No resampling of 1m bars, no invented candles, no premarket, no unfinished sessions.
"""
from __future__ import annotations
import datetime as dt
import json
import math
import pathlib
import time
import urllib.parse
import urllib.request
from zoneinfo import ZoneInfo

ROOT = pathlib.Path(__file__).resolve().parents[1]
DEST = ROOT / "data" / "taiyo-yuden-5m.json"
SYMBOL = "6976.T"
JST = ZoneInfo("Asia/Tokyo")
HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; TaiyoYudenResearch/2.0)",
    "Accept": "application/json",
}

def number(value):
    try:
        num = float(value)
    except (ValueError, TypeError):
        return None
    return num if math.isfinite(num) else None

def fetch():
    now = int(time.time())
    # Yahoo intraday chart data has a 60-day limit for 5-minute candles.
    # Avoid the cutoff by two days to prevent API boundary ambiguity.
    query = urllib.parse.urlencode({
        "interval": "5m",
        "period1": now - 58 * 86400,
        "period2": now + 300,
        "includePrePost": "false",
    })
    errors = []
    for host in ("query1.finance.yahoo.com", "query2.finance.yahoo.com"):
        for attempt in range(2):
            try:
                url = f"https://{host}/v8/finance/chart/{urllib.parse.quote(SYMBOL)}?{query}"
                with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=25) as response:
                    payload = json.load(response)
                result = payload["chart"]["result"][0]
                quote = result["indicators"]["quote"][0]
                now_jst = dt.datetime.now(JST)
                rows = []
                for ts, o, h, l, c, v in zip(
                    result.get("timestamp") or [],
                    quote["open"], quote["high"], quote["low"],
                    quote["close"], quote["volume"]
                ):
                    candle = dt.datetime.fromtimestamp(int(ts), JST)
                    minute = candle.hour * 60 + candle.minute
                    # Only full 5-minute scheduled candles in Tokyo continuous sessions.
                    # 15:25 is excluded to avoid mixing closing-auction prints.
                    if not (540 <= minute < 690 or 750 <= minute < 925):
                        continue
                    if minute % 5 != 0:
                        continue
                    if candle.date() == now_jst.date() and now_jst.time() < dt.time(15, 40):
                        continue
                    nums = tuple(number(x) for x in (o, h, l, c, v))
                    if any(x is None for x in nums):
                        continue
                    op, hi, lo, cl, volume = nums
                    if op <= 0 or lo <= 0 or hi < max(op, cl) or lo > min(op, cl) or volume < 0:
                        continue
                    rows.append([
                        candle.strftime("%Y-%m-%dT%H:%M"),
                        *[round(x, 5) for x in (op, hi, lo, cl)], int(volume),
                    ])
                if not rows:
                    raise RuntimeError("No real completed-session five-minute candles in API response")
                return rows, errors
            except Exception as exc:
                errors.append(f"{host} attempt={attempt+1} {type(exc).__name__}: {exc}"[:200])
                time.sleep(attempt+1)
    return [], errors

def main():
    try:
        prior = json.loads(DEST.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        prior = {}
    old = {row[0]: row for row in prior.get("bars", [])
           if isinstance(row, list) and len(row) == 6 and isinstance(row[0], str)}
    recent, errors = fetch()
    old.update({row[0]: row for row in recent})
    # Store all accumulated bars for longer backtests; Yahoo's 60-day limit only
    # restricts retroactive acquisition, not independently archived bars.
    bars = [old[k] for k in sorted(old)]
    if bars == prior.get("bars", []):
        print("5m unchanged:",len(bars),"bars",len({b[0][:10] for b in bars}),"dates; errors",len(errors))
        return
    if not bars:
        print("5m unavailable:", errors)
        return
    result = {
        "symbol": SYMBOL, "interval": "5m", "time_zone": "Asia/Tokyo",
        "updated_at": dt.datetime.now(JST).isoformat(timespec="seconds"),
        "source": "Yahoo Finance unofficial chart API; actual 5m candles, no synthesis",
        "bars": bars, "fetch_errors": errors,
    }
    DEST.parent.mkdir(parents=True, exist_ok=True)
    DEST.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print("5m saved:",len(bars),"bars",len({b[0][:10] for b in bars}),"dates; fetched",len(recent),"errors",len(errors))

if __name__ == "__main__":
    main()
