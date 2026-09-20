// SPDX-License-Identifier: GPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { addFiles, parseJam, prepareApplication, MAX_BYTES } from '../web/loader.mjs';
const encode=s=>new TextEncoder().encode(s);
const file=(name,bytes)=>({name,size:bytes.length,arrayBuffer:async()=>bytes.slice().buffer});
const jar=file('demo.jar',new Uint8Array([0x50,0x4b,3,4,1,2]));
const descriptor='AppName=Sample\r\nAppClass=Demo\r\nSPsize=4,4\r\n';
const jam=file('demo.jam',encode(descriptor));
test('JAM continuation, zero-sized regions and prototype-like keys',()=>{
  const parsed=parseJam(encode('AppClass=a$b\nAppParam=abc\n def\nSPsize=0,8\n__proto__=safe'));
  assert.equal(parsed.props.AppParam,'abcdef');assert.equal(parsed.total,8);
  assert.equal(Object.getPrototypeOf(parsed.props),null);
});
test('reject missing entry class, invalid and excessive region sizes',()=>{
  for(const s of ['SPsize=2','AppClass=../oops','AppClass=A\nSPsize=-1','AppClass=A\nSPsize=Infinity',`AppClass=A\nSPsize=${MAX_BYTES+1}`,'AppClass=A\nSPsize='+Array(17).fill('0').join(',')])
    assert.throws(()=>parseJam(encode(s)));
});
test('incremental file selection is transactional and rejects duplicate types',()=>{
  assert.equal(addFiles({jar},[jam]).jar,jar);
  assert.throws(()=>addFiles({jar},[jam,file('second.jam',encode('x'))]));
  assert.throws(()=>addFiles({},[file('dump.bin',new Uint8Array(4))]));
});
test('raw and iDK scratchpads; missing scratchpad starts blank',async()=>{
  const a=await prepareApplication({jar,jam});assert.equal(a.sp.length,8);assert.ok(a.warning);
  const raw=new Uint8Array([1,2,3,4,5,6,7,8]);
  assert.deepEqual((await prepareApplication({jar,jam,sp:file('a.sp',raw)})).sp,raw);
  assert.equal((await prepareApplication({jar,jam,sp:file('a.sp',new Uint8Array(72))})).sp.length,72);
  await assert.rejects(()=>prepareApplication({jar,jam,sp:file('a.sp',new Uint8Array(7))}));
});
test('save identity ignores filenames/SP contents but includes descriptor',async()=>{
  const a=await prepareApplication({jar,jam});
  const b=await prepareApplication({jar:{...jar,name:'renamed.jar'},jam,sp:file('a.sp',new Uint8Array(8).fill(5))});
  const c=await prepareApplication({jar,jam:file('a.jam',encode(descriptor+'AppParam=other\n'))});
  assert.equal(a.id,b.id);assert.notEqual(a.id,c.id);
});
test('reject invalid JAR and incomplete selection before JVM boot',async()=>{
  await assert.rejects(()=>prepareApplication({jar}));
  await assert.rejects(()=>prepareApplication({jar:file('x.jar',encode('not a zip')),jam}));
});
