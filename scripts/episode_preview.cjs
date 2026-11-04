'use strict';
// Reproducible exploratory training example. Never describes in-sample results as holdout.
const fs=require('node:fs');
const path=require('node:path');
const E=require('../episode-engine.js');
const data=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../data/taiyo-yuden-1m.json'),'utf8'));
if(data.symbol!=='6976.T'||data.interval!=='1m'||!Array.isArray(data.bars))throw Error('OHLCV archive invalid');
const ds=E.groupSessions(data.bars).slice(-3);
if(!ds.length)throw Error('No sessions with 60+ actual minute candles');
const rng=E.random(6976);
const firstPolicy=E.fresh(rng);
const initial=E.replay(firstPolicy,ds,0.1);
const result=E.train(ds,null,30,12,0.1);
const last=E.replay(result.weights,ds,0.1);
const preview={
  symbol:'6976.T',kind:'score-only-evolution',
  label:'学習期間内の参考結果・未使用日での検証ではありません',
  dates:ds.map(d=>({date:d.date,bars:d.am.length+d.pm.length,partial:d.am.length<143||d.pm.length<172})),
  generations:result.rounds,population:12,assessedCandidates:360,
  costPct:0.1,
  initial:{score:initial.fitness,totalPct:initial.total,tradeCount:initial.n},
  final:{score:last.fitness,totalPct:last.total,winRatePct:last.winRate,
    tradeCount:last.n,maxDrawdownPct:last.dd},
  improvement:last.fitness-initial.fitness,
  noHoldout:true
};
process.stdout.write(JSON.stringify(preview,null,2)+'\n');
