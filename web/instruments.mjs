// SPDX-License-Identifier: GPL-3.0-or-later
// Reader for user-supplied openDoJa FTRM v1 banks. No instrument data is embedded.
// Format reference: openDoJa FueTrekRom.java / FueTrekSampler.java at
// 0eb46a3905733458d1f7ded49cd1ba8dcc93511f. This is an approximate Web Audio
// sample player, not an implementation of the native FueTrek synthesis engine.
export const MAX_BANK_BYTES=16*1024*1024;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const invalid=message=>new Error('音色ファイル: '+message);

class Reader {
  constructor(bytes){this.bytes=bytes;this.view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);this.offset=0;}
  take(n){
    if(!Number.isSafeInteger(n)||n<0||n>this.bytes.length-this.offset)throw invalid('データが途中で切れています。');
    const start=this.offset;this.offset+=n;return start;
  }
  u8(){return this.view.getUint8(this.take(1));}
  u16(){return this.view.getUint16(this.take(2),true);}
  u32(){return this.view.getUint32(this.take(4),true);}
  data(n){const start=this.take(n);return this.bytes.slice(start,start+n);}
}

class InstrumentBank {
  #samples;#objects;#groups;#cache=new WeakMap();
  constructor(samples,objects,groups){
    this.#samples=samples;this.#objects=objects;this.#groups=groups;
    this.format='FTRM v1';this.sampleCount=samples.length;
    this.programCount=groups.get(0x79).filter(index=>index!==0xffff).length;
    this.drumCount=groups.get(0x78)?.filter(index=>index!==0xffff).length||0;
  }
  buffer(context,index){
    let cache=this.#cache.get(context);if(!cache){cache=new Map();this.#cache.set(context,cache);}
    if(!cache.has(index)){
      const pcm=this.#samples[index].pcm,buffer=context.createBuffer(1,pcm.length,32000),data=buffer.getChannelData(0);
      for(let i=0;i<pcm.length;i++)data[i]=(pcm[i]<<24>>24)/128;
      cache.set(index,buffer);
    }
    return cache.get(index);
  }
  resolve(program,key,drum=false){
    // The existing MLD decoder emits General MIDI program/note numbers. Use the
    // bank's GM melodic/drum groups, not FueTrek's six-voice native bank 0.
    const group=this.#groups.get(drum?0x78:0x79),entry=group?.[drum?key:program];
    if(entry===undefined||entry===0xffff)return null;
    const object=this.#objects[entry];if(key<object.low||key>object.high)return null;
    const zone=object.zones.find(zone=>key<=zone.high);if(!zone)return null;
    const layers=[];
    for(let i=0;i<2;i++){
      const index=zone.indices[i],amplitude=zone.amplitudes[i];
      if(amplitude<=0)continue;
      const sample=this.#samples[index===0xffff?zone.indices[0]:index];
      // Native noise-generator modes require more than a PCM waveform.
      if(!sample||sample.mode!==0)return null;
      const tune=sample.tune+(i?zone.fineB:0);
      if(tune<=0)return null;
      const note=zone.fixed<0?key:zone.fixed;
      const rate=tune/1024*2**((note-sample.root-zone.coarse)/12);
      if(!Number.isFinite(rate)||rate<1/256||rate>256)return null;
      layers.push({index:index===0xffff?zone.indices[0]:index,rate,gain:clamp(amplitude/512,0,2),
        loop:sample.end>sample.start,loopStart:sample.start/32000,loopEnd:sample.end/32000});
    }
    if(!layers.length)return null;
    // Approximate the bank's amplitude envelope with AudioParam curves at the
    // documented 32 kHz / 128-frame control cadence. Native shaping/modulation,
    // fixed-point interpolation and mixer tables are deliberately not emulated.
    const decayTime=value=>value<=0?.004:value>=2048?10:clamp(-.004/Math.log(value/2048),.004,10);
    return {layers,gain:clamp(zone.gain/32,0,2),
      attack:clamp(1984/Math.max(1,zone.attack)*.004,.004,2),
      decay:decayTime(zone.decay),sustain:clamp(zone.sustain/31,0,1),
      release:clamp(decayTime(zone.release)*7,.008,3)};
  }
}

export function parseInstrumentBank(input){
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
  if(bytes.length>MAX_BANK_BYTES)throw invalid('上限は16 MiBです。');
  const r=new Reader(bytes);
  if(r.u32()!==0x4d525446||r.u16()!==1)throw invalid('対応形式は openDoJa の FueTrek 音色ファイル（FTRM v1）です。');
  const sampleCount=r.u16(),objectCount=r.u16(),groupCount=r.u16();
  const pitchCount=r.u16(),interpolationCount=r.u16(),panCount=r.u16(),drumPanCount=r.u16();
  if(!sampleCount||sampleCount>4096||!objectCount||objectCount>4096||!groupCount||groupCount>256)
    throw invalid('音色数が不正です。');
  r.take(pitchCount*4+interpolationCount*2+panCount*2+drumPanCount);
  const samples=[];let totalPcm=0;
  for(let i=0;i<sampleCount;i++){
    const tune=r.u16(),root=r.u8(),mode=r.u8(),start=r.u32(),end=r.u32(),length=r.u32();
    totalPcm+=length;
    if(!length||length>1024*1024||totalPcm>8*1024*1024||root>127||!tune||start>end||end>length)
      throw invalid('波形の長さ・音程・ループ範囲が不正です。');
    samples.push({tune,root,mode,start,end,pcm:r.data(length)});
  }
  const objects=[];let zoneTotal=0;
  for(let i=0;i<objectCount;i++){
    const low=r.u8(),high=r.u8(),count=r.u8(),zones=[];zoneTotal+=count;
    if(low>high||high>127||zoneTotal>16384)throw invalid('音域が不正です。');
    let previous=low-1;
    for(let j=0;j<count;j++){
      const indices=[r.u16(),r.u16()];
      if(indices.some(index=>index!==0xffff&&index>=sampleCount))throw invalid('波形の参照先が不正です。');
      const raw=new Uint8Array(68);raw.set(r.data(4));raw.set(r.data(56),12);
      const v=new DataView(raw.buffer),keyHigh=v.getInt8(0),fixed=v.getInt32(60,true);
      if(keyHigh<previous||keyHigh<low||keyHigh>127||fixed< -1||fixed>127)throw invalid('音色の音域・固定音程が不正です。');
      previous=keyHigh;
      zones.push({high:keyHigh,indices,amplitudes:[v.getInt16(12,true),v.getInt16(14,true)],
        coarse:v.getInt8(16),fineB:v.getInt16(18,true),gain:v.getInt8(20),fixed,
        attack:v.getInt16(40,true),decay:v.getInt16(42,true),release:v.getInt16(44,true),sustain:v.getInt8(47)});
    }
    objects.push({low,high,zones});
  }
  const groups=new Map();
  for(let i=0;i<groupCount;i++){
    const id=r.u8(),entries=[];if(groups.has(id))throw invalid('音色グループが重複しています。');
    for(let j=0;j<128;j++){
      const index=r.u16();if(index!==0xffff&&index>=objectCount)throw invalid('楽器の参照先が不正です。');
      entries.push(index);
    }
    groups.set(id,entries);
  }
  if(r.offset!==bytes.length)throw invalid('末尾に余分なデータがあります。');
  if(!groups.get(0x79)?.some(index=>index!==0xffff))throw invalid('対応する楽器グループがありません。');
  return new InstrumentBank(samples,objects,groups);
}

export async function readInstrumentFile(file){
  if(!file||file.size>MAX_BANK_BYTES)throw invalid('上限は16 MiBです。');
  return parseInstrumentBank(await file.arrayBuffer());
}
