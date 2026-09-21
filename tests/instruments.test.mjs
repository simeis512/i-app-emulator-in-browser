// SPDX-License-Identifier: GPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseInstrumentBank,readInstrumentFile,MAX_BANK_BYTES} from '../web/instruments.mjs';
import {instrumentFixture} from './instrument-fixture.mjs';

test('authored bank selects programs, key zones and fixed-pitch drums',()=>{
  const bank=parseInstrumentBank(instrumentFixture().bytes);
  assert.equal(bank.programCount,4);assert.equal(bank.drumCount,1);assert.equal(bank.sampleCount,3);
  assert.equal(bank.resolve(0,60).layers[0].rate,1);
  assert.equal(bank.resolve(0,72).layers[0].rate,2);
  assert.equal(bank.resolve(2,59).layers[0].index,0);
  assert.equal(bank.resolve(2,60).layers[0].index,1);
  assert.equal(bank.resolve(127,36,true).layers[0].rate,1);
  assert.equal(bank.resolve(4,60),null);assert.equal(bank.resolve(0,35,true),null);
  assert.equal(bank.resolve(3,60),null,'native noise mode must fall back');
});

test('signed PCM is owned by the bank and buffers are cached per context',()=>{
  const fixture=instrumentFixture(),bank=parseInstrumentBank(fixture.bytes);
  fixture.bytes.fill(0);
  const context={createBuffer(channels,length,rate){return {channels,rate,data:new Float32Array(length),getChannelData(){return this.data;}};}};
  const buffer=bank.buffer(context,0);assert.equal(buffer.rate,32000);assert.equal(buffer.data[16],100/128);
  assert.equal(buffer.data[48],-100/128);assert.equal(bank.buffer(context,0),buffer);
  assert.notEqual(bank.buffer({...context},0),buffer);
});

test('truncation at every byte boundary, unknown version and trailing bytes fail',()=>{
  const {bytes}=instrumentFixture();
  for(let n=0;n<bytes.length;n++)assert.throws(()=>parseInstrumentBank(bytes.subarray(0,n)),'length '+n);
  const copy=bytes.slice();copy[4]=2;assert.throws(()=>parseInstrumentBank(copy));
  assert.throws(()=>parseInstrumentBank(new Uint8Array([...bytes,0])));
});

test('reject invalid lengths, loops, sample/object references, duplicate groups and absent GM group',()=>{
  const {bytes,offsets:o}=instrumentFixture();
  for(const mutate of [
    v=>v.setUint16(6,65535,true),
    v=>v.setUint32(o.samples[0]+12,0x7fffffff,true),
    v=>v.setUint32(o.samples[0]+8,257,true),
    v=>v.setUint32(o.samples[0]+4,257,true),
    v=>v.setUint16(o.samples[0],0,true),
    v=>v.setUint16(o.zones[0],3,true),
    v=>v.setUint16(o.groups[0]+1,5,true),
    v=>v.setUint8(o.groups[1],0x79),
    v=>v.setUint8(o.groups[0],0x7d),
    v=>v.setInt32(o.zones[0]+4+52,200,true),
  ]){
    const copy=bytes.slice();mutate(new DataView(copy.buffer));assert.throws(()=>parseInstrumentBank(copy));
  }
});

test('file size limit is checked before reading and filenames do not authorize a format',async()=>{
  let read=false;
  await assert.rejects(()=>readInstrumentFile({size:MAX_BANK_BYTES+1,arrayBuffer(){read=true;}}));assert.equal(read,false);
  await assert.rejects(()=>readInstrumentFile({name:'fuetrek-rom.bin',size:20,arrayBuffer:async()=>new ArrayBuffer(20)}));
  const {bytes}=instrumentFixture();
  assert.equal((await readInstrumentFile({name:'original.bin',size:bytes.length,arrayBuffer:async()=>bytes.buffer})).programCount,4);
});
