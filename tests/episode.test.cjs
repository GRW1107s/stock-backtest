'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const E=require('../episode-engine.js');
const stamp=(day,minute)=>day+'T'+String(Math.floor(minute/60)).padStart(2,'0')+':'+String(minute%60).padStart(2,'0');
function daily(day,offset=0){
  const minutes=[];
  for(let m=540;m<690;m++)minutes.push(m);
  for(let m=750;m<925;m++)minutes.push(m);
  let price=8500+offset;
  return minutes.map((m,i)=>{
    const o=price;
    price+=Math.sin(i/7+offset/100)*13+Math.cos(i/24)*6-0.4;
    const c=price;
    return [stamp(day,m),o,Math.max(o,c)+4,Math.min(o,c)-4,c,4000+Math.round(2000*Math.sin(i/11)**2)];
  });
}
const raw=[...daily('2026-10-29',25).slice(-69),...daily('2026-10-30',10).slice(6),...daily('2026-11-02',-40)];
function policy(){
  const w=Array(E.POLICY_LENGTH).fill(0);
  w[E.FEATURE_COUNT]=1.8;  // Always buy when eligible.
  w[E.FEATURE_COUNT*2+1]=1.8; // Always sell when eligible.
  return w;
}
test('Archive with partial sessions yields three real observed trading days',()=>{
  const ds=E.groupSessions(raw);
  assert.deepEqual(ds.map(x=>x.date),['2026-10-29','2026-10-30','2026-11-02']);
  assert.equal(ds[0].am.length,0);
  assert.equal(ds[0].pm.length,69);
});
test('Episode replay takes only observed real prices and trades chronologically inside each session',()=>{
  const ds=E.groupSessions(raw),result=E.replay(policy(),ds,0.1,true);
  assert.ok(result.trades.length>0);
  for(const t of result.trades){
    assert.equal(t.entry.slice(0,10),t.exit.slice(0,10));
    assert.ok(t.entry<=t.exit);
    assert.ok(t.entry.slice(11,16)<='11:29'&&t.exit.slice(11,16)<='11:29'||
      t.entry.slice(11,16)>='12:30'&&t.exit.slice(11,16)>='12:30');
    assert.ok(Number.isFinite(t.net));
  }
});
test('Features at a time index do not change when FUTURE candles are altered',()=>{
  const ds=E.groupSessions(raw),sample=ds[1].pm;
  const i=28,baseline=E.features(sample,i,null);
  assert.ok(baseline);
  const mutation=sample.map(x=>({...x}));
  for(let j=i+1;j<mutation.length;j++){
    mutation[j].o=90000;mutation[j].h=95000;mutation[j].l=10;mutation[j].c=80000;mutation[j].v=1e9;
  }
  assert.deepEqual(E.features(mutation,i,null),baseline);
});
test('Mutating future DAY cannot affect previous day trading decisions',()=>{
  const ds=E.groupSessions(raw),w=policy();
  const original=E.replay(w,ds,0.1,true);
  const changed=ds.map(d=>({date:d.date,am:d.am.map(x=>({...x})),pm:d.pm.map(x=>({...x}))}));
  for(const s of[changed[2].am,changed[2].pm]){
    for(const b of s){b.o*=1.2;b.h*=1.2;b.l*=1.2;b.c*=1.2;}
  }
  const after=E.replay(w,changed,0.1,true);
  assert.deepEqual(after.trades.filter(t=>t.date===ds[0].date),original.trades.filter(t=>t.date===ds[0].date));
});
test('Score-only evolution is deterministic for a seed and does not worsen the best score',()=>{
  const ds=E.groupSessions(raw);
  const result=E.train(ds,null,5,8,0.1);
  assert.equal(result.rounds,5);
  assert.equal(result.history.length,5);
  assert.equal(result.weights.length,E.POLICY_LENGTH);
  for(let i=1;i<result.history.length;i++)assert.ok(result.history[i].best>=result.history[i-1].best-1e-9);
  const twin=E.train(ds,null,5,8,0.1);
  assert.deepEqual(twin.weights,result.weights);
  assert.deepEqual(twin.history,result.history);
});
test('Continue from saved policy instead of resetting and reject four-day episodes',()=>{
  const ds=E.groupSessions(raw);
  const previous=E.train(ds,null,2,8,0.1);
  const resumed=E.train(ds,previous,2,8,0.1);
  assert.equal(resumed.rounds,4);
  assert.equal(resumed.history.length,4);
  assert.ok(resumed.score>=previous.score-1e-9);
  const extra=E.groupSessions([...raw,...daily('2026-11-04',3)]);
  assert.throws(()=>E.train(extra,null,2,8,0.1),/1〜3取引日/);
});
test('No trading yields a negative penalty, not artificial positive profit',()=>{
  const ds=E.groupSessions(raw),flat=Array(E.POLICY_LENGTH).fill(0);
  const result=E.replay(flat,ds,0.1,true);
  assert.equal(result.n,0);
  assert.equal(result.total,0);
  assert.equal(result.fitness,-0.9);
});
