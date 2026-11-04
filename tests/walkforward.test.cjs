'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {CONFIG,runUpdate}=require('../scripts/walkforward_update.cjs');
function makeArchive(n){
  const bars=[];
  const dates=['2026-10-29','2026-10-30','2026-11-02','2026-11-04','2026-11-05','2026-11-06','2026-11-09','2026-11-10'];
  for(let d=0;d<n;d++){
    let price=8000+d*7;
    for(let m=750;m<825;m++){
      const o=price;
      const c=o+Math.sin((m+d*3)/5)*11+Math.cos(m/9)*5;
      bars.push([dates[d]+'T'+String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0'),
        o,Math.max(o,c)+2,Math.min(o,c)-2,c,Math.round(1000+Math.abs(Math.sin(m/11))*500)]);
      price=c;
    }
  }
  return {symbol:'6976.T',interval:'1m',updated_at:'synthetic-test',bars};
}
test('initial three days train; fourth unseen day is scored but cannot be trained yet',()=>{
  const {state}=runUpdate(makeArchive(4),null);
  assert.deepEqual(state.baseline.dates,['2026-10-29','2026-10-30','2026-11-02']);
  assert.equal(state.evaluations.length,1);
  assert.equal(state.evaluations[0].date,'2026-11-04');
  assert.equal(state.evaluations[0].modelTrainedThrough,'2026-11-02');
  assert.deepEqual(state.pendingDates,['2026-11-04']);
  assert.equal(state.retrainings.length,0);
});
test('three new dates are blind-scored first, then retrained; future date uses new model',()=>{
  const {state:s4}=runUpdate(makeArchive(4),null);
  const {state:s7}=runUpdate(makeArchive(7),s4);
  assert.equal(s7.evaluations.length,4);
  assert.deepEqual(s7.evaluations.slice(0,3).map(x=>x.modelTrainedThrough),
    ['2026-11-02','2026-11-02','2026-11-02']);
  assert.deepEqual(s7.retrainings[0].dates,['2026-11-04','2026-11-05','2026-11-06']);
  assert.equal(s7.evaluations[3].modelTrainedThrough,'2026-11-06');
  assert.deepEqual(s7.pendingDates,['2026-11-09']);
  assert.equal(s7.evaluations[0].profitPct,s4.evaluations[0].profitPct);
  assert.deepEqual(runUpdate(makeArchive(7),s7).state,s7);
});
test('an old evaluated day revision is warned about rather than silently changing score',()=>{
  const {state:s4}=runUpdate(makeArchive(4),null);
  const changed=makeArchive(4);
  changed.bars.at(-1)[4]-=1;
  assert.ok(changed.bars.at(-1)[4]>=changed.bars.at(-1)[3]);
  const {state}=runUpdate(changed,s4);
  assert.deepEqual(state.sourceRevisionWarnings,['2026-11-04']);
  assert.deepEqual(state.evaluations,s4.evaluations);
});
test('wrong archive or incompatible config must fail, not reset scores',()=>{
  assert.throws(()=>runUpdate({symbol:'X',bars:[]},null));
  const {state}=runUpdate(makeArchive(4),null);
  state.config={...CONFIG,costPct:0.5};
  assert.throws(()=>runUpdate(makeArchive(5),state),/config differs/);
});