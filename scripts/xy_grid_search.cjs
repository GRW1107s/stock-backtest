'use strict';
/* Exhaustive 6976 x/y study; selection is TRAIN ONLY.
 * All data comes from the verified minute archive. No synthetic fills.
 * Chronological split: two latest-but-one complete days -> next held-out day.
 */
const fs=require('node:fs'),path=require('node:path'),E=require('../threshold-engine.js');
const payload=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../data/taiyo-yuden-1m.json'),'utf8'));
if(payload.symbol!=='6976.T'||payload.interval!=='1m'||!Array.isArray(payload.bars))
  throw Error('Verified 6976.T 1m archive required');
const all=E.groupSessions(payload.bars);
const complete=all.filter(d=>d.am.length>=140&&d.pm.length>=170&&
  d.pm.some(b=>b.t.endsWith('15:24')));
if(complete.length<2)throw Error('At least two complete days are required for optimization');
const used=complete.slice(-3),inSample=used.slice(0,-1),holdout=used.slice(-1);
const noHoldout=used.length<3;
const xvals=Array.from({length:58},(_,i)=>Number((.15+.05*i).toFixed(2)));
const yvals=Array.from({length:35},(_,i)=>Number((.10+.10*i).toFixed(2)));
const cost=.10;
const cells=[];
function summary(r){return {score:+r.score.toFixed(5),total:+r.total.toFixed(5),
  dd:+r.drawdown.toFixed(5),trades:r.n,winRate:r.winRate===null?null:+r.winRate.toFixed(2),
  mean:r.mean===null?null:+r.mean.toFixed(5)};}
for(const x of xvals)for(const y of yvals){
  const params={x,y};
  const full=E.replay(params,used,cost);
  const training=noHoldout?full:E.replay(params,inSample,cost);
  cells.push({x,y,full:summary(full),train:summary(training)});
}
const minTradesTrain=Math.min(3,Math.max(1,inSample.length*2));
const minTradesFull=Math.min(5,Math.max(1,used.length*2));
const eligible=(cell,field,minTrades)=>cell[field].trades>=minTrades;
function rank(field,minTrades){
  return cells.filter(x=>eligible(x,field,minTrades)).sort((a,b)=>b[field].score-a[field].score||
    b[field].trades-a[field].trades||a.y-b.y||a.x-b.x);
}
const trainTop=rank('train',minTradesTrain),fullTop=rank('full',minTradesFull);
const byXY=new Map(cells.map(c=>[c.x.toFixed(2)+'/'+c.y.toFixed(2),c]));
function neighbors(c,field){
  const around=[];
  for(const dx of[-1,0,1])for(const dy of[-1,0,1]){
    const n=byXY.get((c.x+dx*.05).toFixed(2)+'/'+(c.y+dy*.1).toFixed(2));
    if(n)around.push(n[field].score);
  }
  around.sort((a,b)=>a-b);
  return {median:around[Math.floor(around.length/2)],min:around[0],count:around.length};
}
function robust(field,minTrades){
  return cells.filter(c=>eligible(c,field,minTrades)).map(c=>({c,...neighbors(c,field)}))
    .sort((a,b)=>b.median-a.median||b.min-a.min||b.c[field].score-a.c[field].score||
      a.c.y-b.c.y||a.c.x-b.c.x)[0];
}
const trainBest=trainTop[0],fullBest=fullTop[0];
const trainRobust=robust('train',minTradesTrain),fullRobust=robust('full',minTradesFull);
const testFor=c=>noHoldout?null:summary(E.replay({x:c.x,y:c.y},holdout,cost));
const perDay=c=>used.map(d=>({date:d.date,...summary(E.replay({x:c.x,y:c.y},[d],cost))}));
function result(c,field){return c?{x:c.x,y:c.y,...c[field],perDay:perDay(c)}:null;}
const costSensitivity=[.03,.06,.10,.20].map(costPct=>({costPct,
  trainBest:trainBest?summary(E.replay({x:trainBest.x,y:trainBest.y},used,costPct)):null,
  fullBest:fullBest?summary(E.replay({x:fullBest.x,y:fullBest.y},used,costPct)):null}));
const axes={x:xvals,y:yvals};
const report={version:1,symbol:'6976.T',updatedFrom:payload.updated_at||null,
  note:'IN-SAMPLE parameter sweep. Chronological 2+1 test uses last day ONLY to evaluate training-selected parameters.',
  rules:{reference:'latest 30 contiguous one-minute highs',entry:'next observed bar open after x percent downward crossing',
    exit:'y percent target, fixed 0.8 percent stop, max 25 minute hold, flatten at session close',
    maxTradesPerDay:3,roundTripCostPct:cost,exitSameBar:'stop first',dataFilling:'none'},
  dates:used.map(d=>({date:d.date,am:d.am.length,pm:d.pm.length,partial:d.am.length<149||d.pm.length<174||!d.am.some(b=>b.t.endsWith('09:00'))})),
  trainingDates:inSample.map(d=>d.date),testDates:noHoldout?[]:holdout.map(d=>d.date),
  search:{gridSize:cells.length,axes,minTradesTrain,minTradesFull},
  trainingBest:result(trainBest,'train'),testForTrainingBest:testFor(trainBest),
  trainingRobust:trainRobust?{...result(trainRobust.c,'train'),neighborMedian:trainRobust.median,neighborMin:trainRobust.min,
    test:testFor(trainRobust.c)}:null,
  fullBest:result(fullBest,'full'),
  fullRobust:fullRobust?{...result(fullRobust.c,'full'),neighborMedian:fullRobust.median,neighborMin:fullRobust.min}:null,
  topFull:fullTop.slice(0,15).map(c=>({x:c.x,y:c.y,...c.full})),
  topTrain:trainTop.slice(0,10).map(c=>({x:c.x,y:c.y,...c.train})),
  costSensitivity,
  // Each cell is scored on the same three observed trading days; test scores are
  // deliberately omitted from the grid to prevent selecting by the held-out day.
  grid:cells.map(c=>[c.x,c.y,c.full.score,c.full.total,c.full.trades,c.train.score,c.train.trades])};
process.stdout.write(JSON.stringify(report)+'\n');
