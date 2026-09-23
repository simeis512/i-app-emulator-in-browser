// SPDX-License-Identifier: GPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { addFiles, parseJam, prepareApplication, usesOpenGl, MAX_BYTES } from '../web/loader.mjs';
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
// A minimal ZIP writer: entries are stored (0) or deflated (8); unpacked overrides the declared size.
function zip(entries) {
  const parts=[],central=[];let offset=0;
  for(const {name,data,method=8,flags=0,unpacked=data.length} of entries) {
    const n=encode(name),packed=method===8?new Uint8Array(deflateRawSync(data)):data;
    const local=new Uint8Array(30+n.length),l=new DataView(local.buffer);
    l.setUint32(0,0x04034b50,true);l.setUint16(6,flags,true);l.setUint16(8,method,true);l.setUint32(18,packed.length,true);
    l.setUint32(22,unpacked,true);l.setUint16(26,n.length,true);local.set(n,30);
    const entry=new Uint8Array(46+n.length),c=new DataView(entry.buffer);
    c.setUint32(0,0x02014b50,true);c.setUint16(8,flags,true);c.setUint16(10,method,true);c.setUint32(20,packed.length,true);
    c.setUint32(24,unpacked,true);c.setUint16(28,n.length,true);c.setUint32(42,offset,true);entry.set(n,46);
    parts.push(local,packed);central.push(entry);offset+=local.length+packed.length;
  }
  const end=new Uint8Array(22),e=new DataView(end.buffer),size=central.reduce((a,c)=>a+c.length,0);
  e.setUint32(0,0x06054b50,true);e.setUint16(8,entries.length,true);e.setUint16(10,entries.length,true);
  e.setUint32(12,size,true);e.setUint32(16,offset,true);
  const all=[...parts,...central,end],out=new Uint8Array(all.reduce((a,c)=>a+c.length,0));let at=0;
  for(const part of all){out.set(part,at);at+=part.length;}
  return out;
}
const cls=text=>encode('constant pool '+text);
test('OpenGL ES classes select the 3D runtime whether deflated or stored',async()=>{
  assert.equal(await usesOpenGl(zip([{name:'a.class',data:cls('Main')},{name:'b.class',data:cls('Lcom/nttdocomo/ui/ogl/GraphicsOGL;')}])),true);
  assert.equal(await usesOpenGl(zip([{name:'c.class',data:cls('com/nttdocomo/opt/ui/ogl/GraphicsOGL2'),method:0}])),true);
});
test('j3d and resource text alone keep the 2D runtime',async()=>{
  assert.equal(await usesOpenGl(zip([{name:'a.class',data:cls('com/nttdocomo/opt/ui/j3d/Graphics3D')},
    {name:'ogl.txt',data:encode('com/nttdocomo/ui/ogl/')},{name:'com/nttdocomo/ui/ogl/',data:encode(''),method:0}])),false);
});
test('unreadable archives are reported instead of guessed',async()=>{
  const good=[{name:'a.class',data:cls('com/nttdocomo/ui/ogl/GraphicsOGL')}];
  await assert.rejects(()=>usesOpenGl(new Uint8Array([0x50,0x4b,3,4,1,2])));
  await assert.rejects(()=>usesOpenGl(zip(good).subarray(0,40)));
  await assert.rejects(()=>usesOpenGl(zip([{...good[0],unpacked:8}])));
  await assert.rejects(()=>usesOpenGl(zip([{...good[0],unpacked:4096}])));
  await assert.rejects(()=>usesOpenGl(zip([{...good[0],flags:1}])));
  await assert.rejects(()=>usesOpenGl(zip([{...good[0],method:12}])));
});
