#!/usr/bin/env python3
"""Append verified Taiyo Yuden (6976.T) 1-minute OHLCV to a rolling archive.

The Yahoo unofficial chart endpoint usually provides only ~7 calendar days of
1m history. No interpolation, forward fills or invented bars. Schedule this
after the Tokyo close on each trading day to build 20+ full sessions over time.
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
DEST = ROOT / 'data' / 'taiyo-yuden-1m.json'
SYMBOL = '6976.T'
UTC = dt.timezone.utc
JST = ZoneInfo('Asia/Tokyo')
HEADERS = {'User-Agent':'Mozilla/5.0 (compatible; PersonalTaiyoYudenResearch/1.0)',
           'Accept':'application/json'}


def valid(x):
    try:
        f = float(x)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def fetch_1m():
    """Request a short window to stay inside Yahoo's one-minute lookback cap."""
    now = int(time.time())
    query = urllib.parse.urlencode({'interval':'1m','period1':now-6*86400,
                                    'period2':now+300,'includePrePost':'false'})
    errors = []
    for host in ('query1.finance.yahoo.com','query2.finance.yahoo.com'):
        for attempt in range(2):
            try:
                url = f'https://{host}/v8/finance/chart/{urllib.parse.quote(SYMBOL)}?{query}'
                req = urllib.request.Request(url,headers=HEADERS)
                with urllib.request.urlopen(req,timeout=25) as res:
                    payload = json.load(res)
                result = payload['chart']['result'][0]
                quote = result['indicators']['quote'][0]
                bars = []
                now_jst = dt.datetime.now(JST)
                for ts,o,h,l,c,v in zip(result.get('timestamp') or [],
                                       quote['open'],quote['high'],quote['low'],
                                       quote['close'],quote['volume']):
                    candle = dt.datetime.fromtimestamp(int(ts),JST)
                    minute = candle.hour*60+candle.minute
                    # Reject unfinished session (today) until 15:40 JST.
                    if candle.date() == now_jst.date() and now_jst.time() < dt.time(15,40):
                        continue
                    if not (540 <= minute < 690 or 750 <= minute < 930):
                        continue
                    nums = [valid(x) for x in (o,h,l,c,v)]
                    if any(x is None for x in nums):
                        continue
                    op,hi,lo,cl,vol = nums
                    if op<=0 or lo<=0 or hi<max(op,cl) or lo>min(op,cl) or vol<0:
                        continue
                    key = candle.strftime('%Y-%m-%dT%H:%M')
                    bars.append([key,*[round(n,5) for n in (op,hi,lo,cl)],int(vol)])
                if not bars:
                    raise RuntimeError('No completed-session 1m candles in response')
                return bars,errors
            except Exception as exc:
                errors.append(f'{host} attempt={attempt+1}: {type(exc).__name__}: {exc}'[:180])
                time.sleep(attempt+1)
    return [],errors


def main():
    try:
        previous = json.loads(DEST.read_text(encoding='utf-8'))
    except (OSError,ValueError):
        previous = {}
    merged = {row[0]:row for row in previous.get('bars',[])
              if isinstance(row,list) and len(row)==6 and isinstance(row[0],str)}
    fresh,errors = fetch_1m()
    # An outage must never replace earlier history with empty/invented candles.
    for row in fresh:
        merged[row[0]] = row
    if not merged:
        print('No valid 1m bars yet. Source errors:',errors)
        return
    cutoff = (dt.datetime.now(JST).date()-dt.timedelta(days=55)).isoformat()
    bars = [merged[k] for k in sorted(merged) if k[:10]>=cutoff]
    payload = {'symbol':SYMBOL,'interval':'1m','time_zone':'Asia/Tokyo',
               'updated_at':dt.datetime.now(JST).isoformat(timespec='seconds'),
               'source':'Yahoo Finance unofficial chart API (rolling archive; no synthetic candles)',
               'bars':bars,'fetch_errors':errors}
    # Don't create a new diff/commit on days when source returns no new data.
    if bars == previous.get('bars',[]):
        print('No bar changes; retained',len(bars),'archived candles; errors=',errors)
        return
    DEST.parent.mkdir(parents=True,exist_ok=True)
    DEST.write_text(json.dumps(payload,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
    print('Archived',len(bars),'1m candles across',len({x[0][:10] for x in bars}),
          'dates; new from latest fetch',len(fresh),'source errors',len(errors))

if __name__ == '__main__':
    main()
