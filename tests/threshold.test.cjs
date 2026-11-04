'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const E=require('../threshold-engine.js');
const stamp=(date,m)=>date+'T'+String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
function day(date,offset=0){
  let price=8400+offset;
  const times=[];
  for(let m=540;m<690;m++)times.push(m);
  for(let m=750;m<925;m++)times.push(m);
  return times.map((m,i)=>{
    const o=price;price+=Math.sin((i+offset)/7)*11+Math.cos(i/19)*5-0.8;
    return [stamp(date,m),o,Math.max(o,price)+2,Math.min(o,price)-2,price,4000+i%100];
  });
}
const rows=[...day('2026-10-29',5).slice(-69),...day('2026-10-30',18).slice(6),
  ...day('2026-11-02',26)];
test('Partial real trading dates are accepted but not invented',()=>{
  const grouped=E.groupSessions(rows);
  assert.equal(grouped.length,3);
  assert.equal(grouped[0].am.length,0);
  assert.equal(grouped[0].pm.length,69);
});
test('Buy signal occurs at x percent downward crossing of previous 30 actual minutes',()=>{
  const s=[];
  for(let i=0;i<50;i++){
    const c=i<34?100:(i===34?99.5:99.5);
    s.push({t:stamp('2026-11-02',540+i),o:c,h:i===34?100:100,l:c,c,v:100});
  }
  // Previous bar drawdown was 0%; current bar crosses 0.40%.
  assert.equal(E.dropSignal(s,33,0.4),false);
  assert.equal(E.dropSignal(s,34,0.4),true);
  assert.equal(E.dropSignal(s,35,0.4),false);
});
test('No future candles influence a previous buy signal',()=>{
  const d=E.groupSessions(rows)[1].am,i=35;
  const before=E.dropSignal(d,i,.20),mutation=d.map(b=>({...b}));
  for(let j=i+1;j<mutation.length;j++){
    mutation[j].o=90000;mutation[j].h=100000;mutation[j].l=2;mutation[j].c=1000;
  }
  assert.equal(E.dropSignal(mutation,i,.20),before);
});
test('Trades use only next minute open and finish within observed session',()=>{
  const ds=E.groupSessions(rows);
  const params={x:0.15,y:0.10};
  const t=E.replay(params,ds,.1,true);
  assert.ok(t.n>0,'At least one downward crossing must trade in volatile synthetic data');
  for(const tr of t.trades){
    assert.equal(tr.entry.slice(0,10),tr.exit.slice(0,10));
    assert.ok(tr.entry<=tr.exit);
    assert.ok(tr.entry.slice(11,16)<='11:29'&&tr.exit.slice(11,16)<='11:29'||
      tr.entry.slice(11,16)>='12:30'&&tr.exit.slice(11,16)>='12:30');
    assert.ok(Number.isFinite(tr.net));
  }
});
test('Future-day changes do not alter earlier day trades',()=>{
  const ds=E.groupSessions(rows),p={x:0.15,y:0.25};
  const original=E.replay(p,ds,0.1,true);
  const mutated=ds.map(d=>({date:d.date,am:d.am.map(x=>({...x})),pm:d.pm.map(x=>({...x}))}));
  for(const a of [...mutated[2].am,...mutated[2].pm]){
    a.o*=1.20;a.h*=1.20;a.l*=1.20;a.c*=1.20;
  }
  const changed=E.replay(p,mutated,0.1,true);
  assert.deepEqual(changed.trades.filter(x=>x.date===ds[0].date),
    original.trades.filter(x=>x.date===ds[0].date));
});
test('Score-only training improves or preserves score and is deterministic',()=>{
  const ds=E.groupSessions(rows),initial={x:0.6,y:0.5};
  const base=E.replay(initial,ds,.1).score;
  const r=E.train(ds,null,5,12,.1,initial),same=E.train(ds,null,5,12,.1,initial);
  assert.equal(r.rounds,5);assert.equal(r.history.length,5);
  assert.ok(r.score>=base-1e-9);
  assert.deepEqual(r.params,same.params);
  for(let i=1;i<r.history.length;i++)assert.ok(r.history[i].best>=r.history[i-1].best-1e-9);
});
test('Continue from the same x/y rather than resetting parameters',()=>{
  const ds=E.groupSessions(rows);
  const p=E.train(ds,null,2,8,0.1);
  const continued=E.train(ds,p,3,8,0.1);
  assert.equal(continued.rounds,5);
  assert.ok(continued.score>=p.score-1e-9);
  assert.ok(continued.params.x>=E.X_MIN&&continued.params.x<=E.X_MAX);
  assert.ok(continued.params.y>=E.Y_MIN&&continued.params.y<=E.Y_MAX);
});
test('No-trade rule is penalized, and invalid parameters and four-day training rejected',()=>{
  const ds=E.groupSessions(rows);
  const flatDay=E.groupSessions(day('2026-11-04',2).map(b=>[b[0],100,100,100,100,b[5]]));
  assert.equal(E.replay({x:3.0,y:2.0},flatDay,.1).score,-0.9);
  assert.throws(()=>E.replay({x:0,y:.2},ds,.1));
  assert.throws(()=>E.train([...ds,E.groupSessions(day('2026-11-04',2))[0]],null,1,8,.1),/1〜3/);
});
