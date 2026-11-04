'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../five-minute-engine.js');
function stamp(date,m){return date+'T'+String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0')}
function day(date,shift=0){
  let prev=8500+shift;
  const times=[];
  for(let m=540;m<690;m+=5)times.push(m);
  for(let m=750;m<925;m+=5)times.push(m);
  return times.map((m,i)=>{
    const op=prev;
    prev+=17*Math.sin(i/2.5+shift/20)-7;
    return [stamp(date,m),op,Math.max(op,prev)+5,Math.min(op,prev)-5,prev,900+i];
  });
}
const samples=[...day('2026-10-30'),...day('2026-11-02',50),...day('2026-11-04',100)];
test('5m OHLCV sessions normalize without artificial candles',()=>{
  const d=E.group(samples);assert.equal(d.length,3);
  assert.ok(d.every(E.completed));
  assert.equal(d[0].am.length,30);assert.equal(d[0].pm.length,35);
});
test('No future data may influence an x% downward crossing',()=>{
  const a=E.group(samples)[0].am,at=8;
  const b=a.map(x=>({...x}));
  const before=E.dropSignal(a,at,.2);
  for(let j=at+1;j<b.length;j++){b[j].h*=2;b[j].c*=.2;}
  assert.equal(E.dropSignal(b,at,.2),before);
});
test('No signal spans lunch or missing five-minute bars',()=>{
  const d=E.group(samples)[0];
  const pm=d.pm.map(x=>({...x}));
  pm.splice(6,1);
  assert.equal(E.dropSignal(pm,7,.2),false);
  assert.equal(E.dropSignal(pm,8,.2),false);
});
test('Trades execute only after signal and stay within same session with max 3 entries/day',()=>{
  const d=E.group(samples),r=E.replay(d,{x:.2,y:.8},.1,true);
  assert.ok(r.trades>0);
  const byDay=new Map();
  for(const t of r.log){
    assert.ok(t.entry<=t.exit);
    assert.equal(t.entry.slice(0,10),t.exit.slice(0,10));
    assert.equal(t.entry.slice(11,16)<='11:25',t.exit.slice(11,16)<='11:25');
    byDay.set(t.date,(byDay.get(t.date)||0)+1);
  }
  assert.ok([...byDay.values()].every(n=>n<=3));
});
test('Changes to future day do not change earlier trade list',()=>{
  const d=E.group(samples),a=E.replay(d,{x:.2,y:1.2},.1,true);
  const altered=d.map(x=>({date:x.date,am:x.am.map(y=>({...y})),pm:x.pm.map(y=>({...y}))}));
  for(const b of [...altered[2].am,...altered[2].pm]){b.o*=1.5;b.h*=1.5;b.l*=1.5;b.c*=1.5}
  const z=E.replay(altered,{x:.2,y:1.2},.1,true);
  assert.deepEqual(z.log.filter(x=>x.date===d[0].date),a.log.filter(x=>x.date===d[0].date));
});
test('Zero trade policy gets penalty not profit',()=>{
  const d=E.group(samples.map(x=>[x[0],100,100,100,100,x[5]]));
  assert.equal(E.replay(d,{x:3,y:3},.1).score,-.9);
});
