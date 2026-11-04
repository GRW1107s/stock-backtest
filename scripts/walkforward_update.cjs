'use strict';
/* Incremental score-only walk-forward. Each new day is scored before its
 * candles may be used for a later three-day training block. */
const E = require('../episode-engine.js');
const CONFIG = Object.freeze({symbol:'6976.T',costPct:0.10,
  // Illustrative round-trip percentages, NOT a broker-specific published schedule.
  commissionPct:0.02,spreadPct:0.04,slippagePct:0.04,
  sensitivityCostsPct:[0,0.05,0.10,0.20,0.30],
  population:10,chunks:[25,25,50,100],blockDays:3});
function summary(r) {
  return {score:r.fitness,profitPct:r.total,drawdownPct:r.dd,trades:r.n,wins:r.wins,
    winRatePct:r.winRate};
}
function fingerprint(d) {
  const all=[...d.am,...d.pm];
  return {bars:all.length,last:all.at(-1)?.t||null,lastClose:all.at(-1)?.c||null};
}
function trainBlock(days,previousWeights) {
  let p=previousWeights?{weights:previousWeights.slice(),rounds:0,history:[]}:null;
  for (const rounds of CONFIG.chunks) p=E.train(days,p,rounds,CONFIG.population,CONFIG.costPct);
  return {weights:p.weights,summary:summary(p.summary),rounds:p.rounds};
}
function runUpdate(payload,previous) {
  if(payload?.symbol!==CONFIG.symbol||payload?.interval!=='1m'||!Array.isArray(payload.bars))
    throw Error('Expected verified 6976.T one-minute archive');
  const days=E.groupSessions(payload.bars);
  if(previous&&(previous.version!==1||JSON.stringify(previous.config)!==JSON.stringify(CONFIG)))
    throw Error('Existing state config differs. Never silently overwrite learned history.');
  if(!previous&&days.length<3) return {state:null,reason:'初期学習には3取引日必要です。'};
  const byDate=new Map(days.map(d=>[d.date,d]));
  let state=previous?JSON.parse(JSON.stringify(previous)):null;
  if(!state) {
    const first=days.slice(0,3), trained=trainBlock(first,null);
    state={version:1,config:CONFIG,generatedFrom:payload.updated_at||null,
      baseline:{dates:first.map(d=>d.date),bars:first.map(fingerprint),...trained.summary},
      weights:trained.weights,trainedThrough:first.at(-1).date,lastEvaluatedDate:first.at(-1).date,
      evaluations:[],retrainings:[],pendingDates:[]};
  }
  // Existing scored dates are immutable. Alert on source revisions rather
  // than retrospectively modifying an allegedly blind score.
  const revised=[];
  for(const row of state.evaluations){
    const d=byDate.get(row.date);
    if(d&&JSON.stringify(fingerprint(d))!==JSON.stringify(row.source))
      revised.push(row.date);
  }
  state.sourceRevisionWarnings=revised;
  const newDays=days.filter(d=>d.date>state.lastEvaluatedDate);
  for(const d of newDays){
    const result=E.replay(state.weights,[d],CONFIG.costPct);
    const costSensitivity=CONFIG.sensitivityCostsPct.map(costPct=>({costPct,
      ...summary(E.replay(state.weights,[d],costPct))}));
    state.evaluations.push({date:d.date,...summary(result),costSensitivity,
      source:fingerprint(d),modelTrainedThrough:state.trainedThrough});
    state.pendingDates.push(d.date);
    state.lastEvaluatedDate=d.date;
    if(state.pendingDates.length===CONFIG.blockDays){
      const block=state.pendingDates.map(date=>byDate.get(date));
      if(block.some(x=>!x))throw Error('Cannot train: a scored day has expired from archive.');
      const trained=trainBlock(block,state.weights);
      state.weights=trained.weights;
      state.trainedThrough=block.at(-1).date;
      state.retrainings.push({dates:block.map(x=>x.date),trainedThrough:state.trainedThrough,
        ...trained.summary});
      state.pendingDates=[];
    }
  }
  state.generatedFrom=payload.updated_at||state.generatedFrom||null;
  const e=state.evaluations;
  state.oosCostSensitivity=CONFIG.sensitivityCostsPct.map(costPct=>({costPct,
    profitPct:e.reduce((n,x)=>n+(x.costSensitivity?.find(v=>v.costPct===costPct)?.profitPct||0),0),
    trades:e.reduce((n,x)=>n+x.trades,0)}));
  state.oosSummary={
    days:e.length,trades:e.reduce((n,x)=>n+x.trades,0),
    wins:e.reduce((n,x)=>n+x.wins,0),
    profitPct:e.reduce((n,x)=>n+x.profitPct,0),
    winRatePct:e.reduce((n,x)=>n+x.wins,0)/
      Math.max(1,e.reduce((n,x)=>n+x.trades,0))*100
  };
  return {state,reason:null};
}
module.exports={CONFIG,runUpdate,trainBlock,fingerprint};
if(require.main===module){
  const fs=require('node:fs'),path=require('node:path');
  const root=path.resolve(__dirname,'..');
  const data=JSON.parse(fs.readFileSync(path.join(root,'data/taiyo-yuden-1m.json'),'utf8'));
  const dest=path.join(root,'data/walkforward-state.json');
  let previous=null;
  try{previous=JSON.parse(fs.readFileSync(dest,'utf8'))}
  catch(e){if(e.code!=='ENOENT')throw e;}
  const {state,reason}=runUpdate(data,previous);
  if(!state){console.log('Walk-forward not ready:',reason);process.exit(0);}
  const next=JSON.stringify(state,null,2)+'\n';
  if(!fs.existsSync(dest)||fs.readFileSync(dest,'utf8')!==next)
    fs.writeFileSync(dest,next);
  console.log('Walk-forward:',state.evaluations.length,'blind test days;',
    state.retrainings.length,'retraining blocks;',
    'pending',state.pendingDates.length,'of',CONFIG.blockDays,
    'out-of-sample return',state.oosSummary.profitPct.toFixed(3)+'%');
}
