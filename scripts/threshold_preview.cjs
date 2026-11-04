'use strict';
const fs=require('node:fs'),path=require('node:path'),E=require('../threshold-engine.js');
const data=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../data/taiyo-yuden-1m.json'),'utf8'));
if(data.symbol!=='6976.T'||data.interval!=='1m'||!Array.isArray(data.bars))throw Error('Invalid archive');
const days=E.groupSessions(data.bars).slice(-3);
if(days.length<1)throw Error('No observed sessions');
const init={x:0.6,y:0.5},cost=0.1,initial=E.replay(init,days,cost);
let best=null;
for(let i=0;i<30;i++)best=E.train(days,best,1,12,cost,init);
const final=E.replay(best.params,days,cost);
const result={
  symbol:'6976.T',description:'学習期間内の試行結果。未来の期間外テストではありません。',
  dates:days.map(d=>({date:d.date,n:d.am.length+d.pm.length,partial:d.am.length<143||d.pm.length<172})),
  rounds:30,candidates:360,costPct:cost,
  initial:{...init,score:initial.score,total:initial.total,n:initial.n},
  final:{...best.params,score:final.score,total:final.total,n:final.n,winRate:final.winRate,drawdown:final.drawdown},
  improvement:final.score-initial.score,noHoldout:true
};
process.stdout.write(JSON.stringify(result,null,2)+'\n');
