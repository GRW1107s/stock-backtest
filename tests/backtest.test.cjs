'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const inputs={};
function el(id){return inputs[id]??(inputs[id]={value:'0.10',disabled:false,innerHTML:'',textContent:'',className:'',addEventListener(){},files:[]});}
const context={document:{getElementById:el},console,Intl,Date,Math,Number,String,Map,Set,Promise,Array,JSON,RegExp,
  setTimeout:()=>{},fetch:()=>new Promise(()=>{}),__STRATEGY_LAB_TEST__:true};
context.globalThis=context;
vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../app.js'),'utf8'),context);
const engine=context.__STRATEGY_LAB_TEST_API__;
function stamp(day,minute){const h=Math.floor(minute/60),m=minute%60;return `${day}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;}
function daily(day,offset){
 let close=1000+offset,rows=[];
 const minutes=[];for(let m=540;m<690;m++)minutes.push(m);for(let m=750;m<930;m++)minutes.push(m);
 for(let i=0;i<minutes.length;i++){
   let open=close;
   close=Math.max(100,close+Math.sin(i/10+offset)*1.5+Math.sin(i/21)*1.1+(i>10&&i<30?0.4:0));
   rows.push([stamp(day,minutes[i]),open,Math.max(open,close)+0.3,Math.min(open,close)-0.3,close,1000+i%100]);
 }
 return rows;
}
function makeTwenty(){const rows=[];for(let i=1;i<=20;i++)rows.push(...daily('2026-10-'+String(i).padStart(2,'0'),i));return rows;}
test('20-session historical OHLCV required, complete sessions accepted',()=>{
 const norm=engine.normalizeBars(makeTwenty()); const days=engine.groupSessions(norm);
 assert.equal(days.length,20);
 assert.ok(days.every(engine.completed));
});
test('No future bars enter signal function, even if future candle altered',()=>{
 const rows=daily('2026-10-01',1).slice(0,70).map(a=>({t:a[0],o:a[1],h:a[2],l:a[3],c:a[4],v:a[5]}));
 const cfg=engine.candidates[0];
 const original=engine.signal(rows.slice(0,31),cfg);
 for(let i=31;i<rows.length;i++){rows[i].o=500;rows[i].h=10000;rows[i].l=1;rows[i].c=9999;rows[i].v=999999;}
 assert.equal(original,engine.signal(rows.slice(0,31),cfg));
});
test('No entry before next minute, trades flat before midday and afternoon close',()=>{
 const days=engine.groupSessions(engine.normalizeBars(makeTwenty()));
 for(const strategy of engine.candidates){
  const trades=engine.simulate(days.slice(0,10),strategy,0.1);
  for(const t of trades){
   assert.ok(t.entry<t.exit || t.entry===t.exit,'exit at/after entry');
   const hr=t.entry.slice(11,16); const afternoon=hr>='12:30';
   assert.equal(t.entry.slice(0,10),t.exit.slice(0,10));
   if(afternoon)assert.ok(t.exit.slice(11,16)<='15:29');
   else assert.ok(t.exit.slice(11,16)<='11:29');
   assert.ok(Number.isFinite(t.net));
  }
 }
});
test('Chronological holdout yields only fixed training-selected parameters',()=>{
 const days=engine.groupSessions(engine.normalizeBars(makeTwenty()));
 const report=engine.run(days,0.1);
 assert.equal(report.length,6);
 for(const r of report){
  assert.ok(r.selected===null||r.selected.id===r.id);
  assert.ok(r.trades.every(x=>x.date>='2026-10-11'));
 }
});
test('CSV with Unix timestamps (UTC) is normalized to JST',()=>{
 const sec=Date.parse('2026-10-01T00:00:00Z')/1000;
 const c=`time,open,high,low,close,volume\n${sec},100,101,99,100.5,12345`;
 const bars=engine.fromCsv(c);
 assert.equal(bars.length,1);
 assert.equal(bars[0][0],'2026-10-01T09:00');
});

test('J-Quants minute CSV with separate Date and Time, abbreviated OHLCV, and code filtering',()=>{
 const csv=`Date,Time,Code,O,H,L,C,Vo,Va
2026-10-21,09:00,69760,1000,1006,998,1002,32100,32160000
2026-10-21,09:01,69760,1002,1005,998,1001,15200,15200000
2026-10-21,09:02,86970,2000,2005,1990,2001,45000,90000000`;
 const bars=engine.fromCsv(csv);
 assert.equal(bars.length,2);
 assert.equal(bars[0][0],'2026-10-21T09:00');
 assert.equal(bars[0][5],32100);
});
test('A fully formed session may end at 15:24 without a 15:25 candle',()=>{
 const day='2026-10-21';
 const rows=daily(day,0).filter(x=>x[0].slice(11,16)<='15:24');
 const sessions=engine.groupSessions(engine.normalizeBars(rows));
 assert.equal(sessions.length,1);
 assert.equal(sessions[0].pm.at(-1).t,day+'T15:24');
 assert.ok(engine.completed(sessions[0]));
});

test('Short exploratory dataset accepts one partial-session day without reporting out-of-sample validation',()=>{
 const bars=daily('2026-10-01',1).slice(-69);
 const day=engine.groupSessions(engine.normalizeBars(bars))[0];
 assert.equal(day.am.length,0);
 assert.equal(day.pm.length,69);
 assert.ok(engine.usableDay(day));
 assert.equal(engine.completed(day),false);
 const out=engine.run([day],0.1);
 assert.equal(out.meta.inSample,true);
 assert.equal(out.meta.trainCount,1);
 assert.equal(out.meta.testCount,0);
 assert.ok(out.every(x=>x.test.n===0));
});
test('Two and three observed days split chronologically, without holdout leakage',()=>{
 const all=engine.groupSessions(engine.normalizeBars(makeTwenty()));
 for(const n of [2,3,7,19,20]){
  const out=engine.run(all.slice(0,n),0.1);
  assert.equal(out.meta.dayCount,n);
  const cutoff=Math.ceil(n/2);
  assert.equal(out.meta.trainCount,cutoff);
  assert.equal(out.meta.testCount,n-cutoff);
  const firstTest=all[cutoff].date;
  assert.ok(out.every(x=>x.trades.every(tr=>tr.date>=firstTest)));
 }
});
test('Non-trading or tiny datasets remain excluded even in provisional mode',()=>{
 const day=engine.groupSessions(engine.normalizeBars(daily('2026-10-01',1).slice(0,30)))[0];
 assert.equal(engine.usableDay(day),false);
});
