'use strict';
/* 6976.T 5m x/y exhaustive search:
 * train selection: chronological older 60% only.
 * holdout: final 40% never involved in choosing x or y.
 * walk forward: last ten days optimize, next three days evaluate, shift 3 days.
 */
const fs=require('node:fs'),path=require('node:path');
const E=require('../five-minute-engine.js');
const file=path.resolve(__dirname,'../data/taiyo-yuden-5m.json');
const raw=JSON.parse(fs.readFileSync(file,'utf8'));
if(raw.symbol!=='6976.T'||raw.interval!=='5m'||!Array.isArray(raw.bars))throw Error('Expected actual 6976.T five-minute archive');
const days=E.group(raw.bars),complete=days.filter(E.completed);
const xs=Array.from({length:29},(_,i)=>+(.2+.1*i).toFixed(2));
const ys=Array.from({length:29},(_,i)=>+(.2+.1*i).toFixed(2));
const combos=xs.flatMap(x=>ys.map(y=>({x,y}))),cost=.10;
const summarize=r=>({score:+r.score.toFixed(5),profitPct:+r.total.toFixed(5),
  trades:r.trades,wins:r.wins,winRatePct:r.winRate===null?null:+r.winRate.toFixed(2),
  drawdownPct:+r.drawdown.toFixed(5)});
const dates=x=>x.map(d=>d.date);
const data={version:1,symbol:'6976.T',interval:'5m',updatedFrom:raw.updated_at,
  availableDays:days.length,completeDays:complete.length,candleCount:raw.bars.length,
  firstDate:days[0]?.date||null,lastDate:days.at(-1)?.date||null,
  coverage:days.map(d=>({date:d.date,am:d.am.length,pm:d.pm.length,complete:E.completed(d)})),
  params:{x:{min:xs[0],max:xs.at(-1),step:.1},y:{min:ys[0],max:ys.at(-1),step:.1}},
  rules:{lookbackBars:6,referenceMinutes:30,stopPct:.8,holdBars:5,holdMinutes:25,
    maxEntriesPerDay:3,roundTripCostPct:cost,nextBarOpen:true,
    sameBarStopFirst:true,missingMinutesFilled:false},
  gridSize:combos.length,trainDays:[],testDays:[],bestTraining:null,holdout:null,
  bestTrainingNeighbors:null,walkForward:[],oos:null,status:'insufficient',
  note:'The held-out period is never used to select trading thresholds. These are historical simulations, not expected profits.'};
function tune(segment,minTrades=5){
  const samples=combos.map(p=>({...p,...summarize(E.replay(segment,p,cost))}));
  const eligible=samples.filter(p=>p.trades>=minTrades);
  eligible.sort((a,b)=>b.score-a.score||b.trades-a.trades||a.x-b.x);
  return {best:eligible[0]||null,samples,eligible:eligible.length};
}
if(complete.length>=13){
  const n=complete.length,k=Math.max(10,Math.floor(n*.6));
  const training=complete.slice(0,k),heldout=complete.slice(k);
  data.trainDays=dates(training);data.testDays=dates(heldout);
  const result=tune(training,Math.max(5,Math.floor(training.length/4)));
  const best=result.best;
  if(best){
    const index=new Map(result.samples.map(p=>[p.x.toFixed(2)+'/'+p.y.toFixed(2),p]));
    const around=[];
    for(const dx of[-1,0,1])for(const dy of[-1,0,1]){
      const cell=index.get((best.x+dx*.1).toFixed(2)+'/'+(best.y+dy*.1).toFixed(2));
      if(cell)around.push(cell.score);
    }
    around.sort((a,b)=>a-b);
    data.bestTraining=best;
    data.bestTrainingNeighbors={count:around.length,min:around[0],median:around[Math.floor(around.length/2)]};
    data.holdout={...summarize(E.replay(heldout,best,cost)),days:dates(heldout)};
    data.costSensitivity=[.05,.10,.20,.30].map(costPct=>({costPct,
      ...summarize(E.replay(heldout,best,costPct))}));
    data.topTraining=result.samples.filter(p=>p.trades>=Math.max(5,Math.floor(training.length/4)))
      .sort((a,b)=>b.score-a.score).slice(0,10);
    data.grid=result.samples.map(p=>[p.x,p.y,p.score,p.trades,p.profitPct]);
    data.status='ok';
  } else {
    data.status='no_eligible_trades';
  }
  for(let start=0;start+13<=complete.length;start+=3){
    const train=complete.slice(start,start+10),test=complete.slice(start+10,start+13);
    const winner=tune(train,4).best;
    if(!winner){
      data.walkForward.push({train:dates(train),test:dates(test),selected:null,testResult:null});
      continue;
    }
    data.walkForward.push({train:dates(train),test:dates(test),
      selected:{x:winner.x,y:winner.y,score:winner.score,trades:winner.trades},
      testResult:summarize(E.replay(test,winner,cost))});
  }
  const valid=data.walkForward.filter(x=>x.testResult);
  const tested=valid.flatMap(x=>x.test),testResults=valid.map(x=>x.testResult);
  data.oos={testDays:tested,segments:valid.length,
    profitPct:+testResults.reduce((a,b)=>a+b.profitPct,0).toFixed(5),
    trades:testResults.reduce((a,b)=>a+b.trades,0),
    wins:testResults.reduce((a,b)=>a+b.wins,0),
    winRatePct:testResults.reduce((a,b)=>a+b.trades,0)?
      +(100*testResults.reduce((a,b)=>a+b.wins,0)/testResults.reduce((a,b)=>a+b.trades,0)).toFixed(2):null};
}
process.stdout.write(JSON.stringify(data)+'\n');
