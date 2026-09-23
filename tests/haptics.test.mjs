// SPDX-License-Identifier: GPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserHaptics } from '../web/haptics.mjs';
function setup(nav={}) {
  const calls=[],messages=[],timers=new Map();let id=0;
  const h=new BrowserHaptics({vibrate:value=>{calls.push(value);return true;},...nav},text=>messages.push(text),
    {setTimeout(fn){timers.set(++id,fn);return id;},clearTimeout(id){timers.delete(id);}});
  return {h,calls,messages,timers,tick(){const pending=[...timers.values()];timers.clear();pending.forEach(fn=>fn());}};
}
test('acceptance never claims that hardware vibrated',()=>{
  const {h,calls,messages}=setup();h.pulse(200);
  assert.ok(calls[0]>0&&calls[0]<=200);assert.match(messages.at(-1),/実際の振動は検出できません/);
});
test('missing and rejected device APIs give different diagnostics',()=>{
  for(const [vibrate,expected] of [[undefined,/対応していません/],[()=>false,/要求を拒否/]]) {
    const {h,messages}=setup({vibrate});h.pulse();assert.match(messages.at(-1),expected);
  }
});
test('key pulses cannot truncate continuous application vibration',()=>{
  const {h,calls,timers,tick}=setup();h.application(true);h.pulse();h.pulse();
  assert.deepEqual(calls,[1500]);assert.equal(timers.size,1);tick();assert.deepEqual(calls,[1500,1500]);
  h.application(false);assert.equal(calls.at(-1),0);assert.equal(timers.size,0);
});
test('an initial or repeated app OFF does not cancel a key pulse',()=>{
  const {h,calls}=setup();h.pulse(200);h.application(false);assert.equal(calls.length,1);assert.ok(calls[0]>0);
});
test('app OFF preserves any remaining key pulse',()=>{
  const {h,calls}=setup();h.pulse(200);h.application(true);h.application(false);
  assert.ok(calls.at(-1)>0&&calls.at(-1)<=200);
});
test('hidden and disabled states stop output and retain the app request for resume',()=>{
  const {h,calls,timers}=setup();h.application(true);h.setVisible(false);
  assert.equal(calls.at(-1),0);assert.equal(timers.size,0);h.pulse();h.application(false);h.application(true);
  assert.equal(calls.at(-1),0);h.setVisible(true);assert.equal(calls.at(-1),1500);
  h.setEnabled(false);assert.equal(calls.at(-1),0);h.setEnabled(true);assert.equal(calls.at(-1),1500);
  h.stop();h.setVisible(false);h.setVisible(true);assert.equal(calls.at(-1),0);assert.equal(timers.size,0);
});
test('gamepad sync and async failures are reported without breaking key input',async()=>{
  for(const fail of [()=>{throw new DOMException('unsupported','NotSupportedError');},
    ()=>Promise.reject(new DOMException('unsupported','NotSupportedError'))]) {
    const {h,messages}=setup({vibrate:undefined,getGamepads:()=>[{vibrationActuator:{playEffect:fail,
      reset:()=>Promise.reject(new Error('unplugged'))}}]});
    h.pulse();await Promise.resolve();assert.match(messages.at(-1),/ゲームパッド: 実行できません（NotSupportedError）/);
    h.stop();await Promise.resolve();
  }
});
test('gamepad completion from an old request cannot replace OFF status',async()=>{
  let resolve;
  const {h,messages}=setup({getGamepads:()=>[{vibrationActuator:{playEffect:()=>new Promise(r=>resolve=r)}}]});
  h.pulse();h.setEnabled(false);resolve('complete');await Promise.resolve();assert.equal(messages.at(-1),'振動はOFFです。');
});
test('pads attached after page load can rumble without navigator.vibrate',async()=>{
  let pads=[];const requests=[];
  const {h,messages}=setup({vibrate:undefined,getGamepads:()=>pads});h.pulse();
  pads=[{vibrationActuator:{playEffect:(kind,options)=>{requests.push([kind,options]);return Promise.resolve('complete');}}}];
  h.pulse(200);await Promise.resolve();assert.equal(requests[0][0],'dual-rumble');
  assert.ok(requests[0][1].duration>0);assert.match(messages.at(-1),/ゲームパッド: 完了/);
});
