// SPDX-License-Identifier: GPL-3.0-or-later
// Original procedural default, with optional user-supplied sample banks.
// No soundfont, recordings or device ROM data are bundled.
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

export function decodeWave(context,input) {
  const bytes=Uint8Array.from(input),view=new DataView(bytes.buffer);
  const tag=offset=>String.fromCharCode(...bytes.subarray(offset,offset+4));
  if(bytes.length<12||tag(0)!=='RIFF'||tag(8)!=='WAVE')throw new Error('Not a RIFF WAVE file');
  let format,channels,rate,bits,align,data;
  for(let offset=12;offset+8<=bytes.length;) {
    const size=view.getUint32(offset+4,true),end=offset+8+size;
    if(end>bytes.length)throw new Error('Truncated WAVE chunk');
    if(tag(offset)==='fmt ') {
      if(size<16)throw new Error('Invalid WAVE format');
      format=view.getUint16(offset+8,true);channels=view.getUint16(offset+10,true);
      rate=view.getUint32(offset+12,true);align=view.getUint16(offset+20,true);bits=view.getUint16(offset+22,true);
    }
    if(tag(offset)==='data')data={offset:offset+8,size};
    offset=end+(size&1);
  }
  if(!data||![1,3].includes(format)||channels<1||channels>8||rate<1000||rate>192000||
     ![8,16,24,32].includes(bits)||(format===3&&bits!==32)||align!==channels*bits/8||data.size%align)
    throw new Error('Unsupported WAVE format (PCM 8/16/24/32 or float32 required)');
  const frames=data.size/align;
  if(!frames||frames*channels>16*1024*1024)throw new Error('Invalid or excessive PCM sample length');
  const buffer=context.createBuffer(channels,frames,rate);
  for(let channel=0;channel<channels;channel++) {
    const target=buffer.getChannelData(channel);
    for(let frame=0;frame<frames;frame++) {
      const offset=data.offset+frame*align+channel*bits/8;let value;
      if(format===3)value=view.getFloat32(offset,true);
      else if(bits===8)value=(bytes[offset]-128)/128;
      else if(bits===16)value=view.getInt16(offset,true)/32768;
      else if(bits===24)value=((bytes[offset]|bytes[offset+1]<<8|bytes[offset+2]<<16)<<8>>8)/8388608;
      else value=view.getInt32(offset,true)/2147483648;
      target[frame]=Number.isFinite(value)?clamp(value,-1,1):0;
    }
  }
  return buffer;
}

export class MidiSynth {
  constructor(context,destination,noise,counters,bank=null) {
    this.context=context;this.noise=noise;this.counters=counters;this.voices=new Set();this.bank=bank;
    this.channels=Array.from({length:16},()=>{
      const gain=context.createGain(),pan=context.createStereoPanner();gain.connect(pan);pan.connect(destination);
      return {gain,pan,volume:100/127,expression:1,bend:0,bendValue:0,bendSemitones:2,bendCents:0,
        rpnMsb:127,rpnLsb:127,modulator:null,sustain:false,program:0,notes:new Map()};
    });
    for(const channel of this.channels)this.level(channel,context.currentTime);
  }
  level(channel,when){channel.gain.gain.setValueAtTime(channel.volume*channel.expression,when);}
  pitch(index,when){
    const channel=this.channels[index];channel.bend=channel.bendValue*(channel.bendSemitones*100+channel.bendCents);
    if(index!==9)for(const note of channel.notes.values())for(const node of note.voice?.sources||[])
      node.detune?.setValueAtTime(channel.bend,when);
  }
  modulation(index,value,when){
    const channel=this.channels[index];if(index===9)return;
    if(value>0&&!channel.modulator){
      const oscillator=this.context.createOscillator(),depth=this.context.createGain();
      // Approximate vibrato for the procedural instruments, not device-specific FM.
      oscillator.frequency.value=6;depth.gain.value=0;oscillator.connect(depth);
      for(const note of channel.notes.values())for(const source of note.voice?.sources||[])if(source.detune)depth.connect(source.detune);
      channel.modulator={oscillator,depth};oscillator.start(when);
    }
    channel.modulator?.depth.gain.setValueAtTime(value/127*50,when);
  }
  message(status,a,b,when,silent=false) {
    const index=status&15,channel=this.channels[index],command=status&240;
    if(command===0x90&&b>0) {
      this.finish(channel.notes.get(a),when,true);
      const note={key:a,velocity:b,down:true,channel:index};channel.notes.set(a,note);
      if(!silent)this.sound(note,when);
    } else if(command===0x80||(command===0x90&&b===0)) {
      const note=channel.notes.get(a);
      if(note){note.down=false;if(!channel.sustain){this.finish(note,when);channel.notes.delete(a);}}
    } else if(command===0xc0)channel.program=a;
    else if(command===0xe0) {
      channel.bendValue=((b<<7|a)-8192)/8192;this.pitch(index,when);
    } else if(command===0xb0) {
      if(a===1)this.modulation(index,b,when);
      if(a===101)channel.rpnMsb=b;
      if(a===100)channel.rpnLsb=b;
      if(a===98||a===99)channel.rpnMsb=channel.rpnLsb=127;
      if((a===6||a===38)&&channel.rpnMsb===0&&channel.rpnLsb===0){
        if(a===6)channel.bendSemitones=b;else channel.bendCents=b;
        this.pitch(index,when);
      }
      if(a===7){channel.volume=b/127;this.level(channel,when);}
      if(a===11){channel.expression=b/127;this.level(channel,when);}
      if(a===10)channel.pan.pan.setValueAtTime(clamp((b-64)/63,-1,1),when);
      if(a===64) {
        channel.sustain=b>=64;
        if(!channel.sustain)for(const [key,note] of channel.notes)if(!note.down){this.finish(note,when);channel.notes.delete(key);}
      }
      if(a===120||a===123){for(const note of channel.notes.values())this.finish(note,when,a===120);channel.notes.clear();}
      if(a===121) {
        channel.volume=100/127;channel.expression=1;channel.bend=0;this.level(channel,when);
        channel.rpnMsb=channel.rpnLsb=127;this.modulation(index,0,when);
        channel.pan.pan.setValueAtTime(0,when);this.message(0xb0|index,64,0,when,silent);
        this.message(0xe0|index,0,64,when,silent);
      }
    }
  }
  chase(){for(const channel of this.channels)for(const note of channel.notes.values())this.sound(note,this.context.currentTime);}
  sound(note,when) {
    // Bound abandoned/missing note-offs, including long sustained chords.
    if(this.voices.size>=64)this.finish(this.voices.values().next().value.note,when,true);
    const context=this.context,channel=this.channels[note.channel],gain=context.createGain();
    const voice={note,gain,sources:[],filters:[],ended:0,finished:false,stopAt:Infinity};note.voice=voice;
    this.voices.add(voice);gain.connect(channel.gain);this.counters.notes++;
    const peak=0.13*note.velocity/127;gain.gain.setValueAtTime(0,when);
    gain.gain.linearRampToValueAtTime(peak,when+0.006);
    const add=(source,filter)=>{
      if(filter){source.connect(filter);filter.connect(gain);voice.filters.push(filter);}else source.connect(gain);
      voice.sources.push(source);
      source.onended=()=>{
        if(source.detune&&channel.modulator)try{channel.modulator.depth.disconnect(source.detune);}catch{}
        source.disconnect();if(++voice.ended!==voice.sources.length)return;
        gain.disconnect();for(const filter of voice.filters)filter.disconnect();this.voices.delete(voice);
        if(channel.notes.get(note.key)===note)channel.notes.delete(note.key);
      };
      source.start(when);return source;
    };
    const instrument=this.bank?.resolve(channel.program,note.key,note.channel===9);
    if(instrument){
      this.counters.bankNotes++;voice.release=instrument.release;
      gain.gain.cancelScheduledValues(when);gain.gain.setValueAtTime(0,when);
      gain.gain.linearRampToValueAtTime(peak*instrument.gain,when+instrument.attack);
      gain.gain.setTargetAtTime(peak*instrument.gain*instrument.sustain,when+instrument.attack,instrument.decay);
      if(instrument.sustain===0)voice.stopAt=when+instrument.attack+instrument.decay*8;
      for(const layer of instrument.layers){
        const source=context.createBufferSource(),level=context.createGain();
        source.buffer=this.bank.buffer(context,layer.index);source.playbackRate.value=layer.rate;
        source.loop=layer.loop;source.loopStart=layer.loopStart;source.loopEnd=layer.loopEnd;
        level.gain.value=layer.gain;
        if(note.channel!==9){source.detune.setValueAtTime(channel.bend,when);channel.modulator?.depth.connect(source.detune);}
        add(source,level);if(Number.isFinite(voice.stopAt))source.stop(voice.stopAt);
      }
    } else if(note.channel===9) {
      if(this.bank)this.counters.bankFallbacks++;
      const kick=[35,36].includes(note.key),tom=[41,43,45,47,48,50].includes(note.key);
      const length=kick?0.22:tom?0.25:[42,44].includes(note.key)?0.07:note.key===46?0.3:0.45;
      voice.stopAt=when+length;
      if(kick||tom) {
        const oscillator=context.createOscillator();oscillator.type='sine';
        oscillator.frequency.setValueAtTime(kick?150:90*Math.pow(2,(note.key-41)/12),when);
        if(kick)oscillator.frequency.exponentialRampToValueAtTime(45,when+0.12);
        add(oscillator).stop(when+length);
      } else {
        const source=context.createBufferSource(),filter=context.createBiquadFilter();source.buffer=this.noise;
        filter.type=[38,40].includes(note.key)?'bandpass':'highpass';filter.frequency.value=filter.type==='bandpass'?1800:6500;
        add(source,filter).stop(when+length);
      }
      gain.gain.exponentialRampToValueAtTime(0.0001,when+length);
    } else {
      if(this.bank)this.counters.bankFallbacks++;
      const oscillator=context.createOscillator(),filter=context.createBiquadFilter();
      const family=channel.program>>3;
      oscillator.type=['triangle','sine','sine','triangle','sawtooth','sawtooth','triangle','sawtooth','square','triangle','square','sawtooth','sine','sine','triangle','sine'][family];
      oscillator.frequency.value=440*Math.pow(2,(note.key-69)/12);oscillator.detune.setValueAtTime(channel.bend,when);
      channel.modulator?.depth.connect(oscillator.detune);
      filter.type='lowpass';filter.frequency.value=family===4?1800:4500;filter.Q.value=0.5;
      add(oscillator,filter);gain.gain.exponentialRampToValueAtTime(peak*(family<=1?0.25:0.7),when+0.18);
    }
  }
  finish(note,when,immediate=false) {
    const voice=note?.voice;if(!voice||voice.finished)return;voice.finished=true;
    const release=immediate?0.004:(voice.release??0.06);
    voice.gain.gain.cancelAndHoldAtTime(when);voice.gain.gain.linearRampToValueAtTime(0,when+release);
    for(const source of voice.sources)try{source.stop(Math.min(voice.stopAt,when+release+0.001));}catch{}
    // A voice scheduled for release must no longer consume a polyphony slot.
    this.voices.delete(voice);
  }
  stop(when){for(const channel of this.channels){for(const note of channel.notes.values())this.finish(note,when,true);channel.notes.clear();}}
  dispose(){this.stop(this.context.currentTime);for(const channel of this.channels){
    channel.gain.disconnect();channel.pan.disconnect();
    if(channel.modulator){channel.modulator.oscillator.stop();channel.modulator.oscillator.disconnect();channel.modulator.depth.disconnect();}
  }}
}

export class BrowserAudio {
  constructor(context,{automatic=true}={}) {
    this.context=context;this.players=new Map();this.counters={notes:0,pcm:0,loaded:0,samples:0,bankNotes:0,bankFallbacks:0};this.errors=[];
    this.instrumentBank=null;this.pcmLevel=0.25;
    this.master=context.createGain();this.master.gain.value=0.3;
    this.limiter=context.createDynamicsCompressor();this.limiter.threshold.value=-6;this.limiter.ratio.value=12;
    this.analyser=context.createAnalyser();this.analyser.fftSize=2048;
    this.master.connect(this.limiter);this.limiter.connect(this.analyser);this.analyser.connect(context.destination);
    this.noise=context.createBuffer(1,Math.ceil(context.sampleRate),context.sampleRate);
    const data=this.noise.getChannelData(0);let seed=0x12345678;
    for(let i=0;i<data.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;data[i]=seed/2147483648-1;}
    if(automatic)this.timer=setInterval(()=>{try{this.pump();}catch(error){this.errors.push(String(error));this.stopAll();}},20);
  }
  async resume(){await this.context.resume();for(const player of this.players.values())if(player.running){
    const position=player.position+(performance.now()-player.wallStart)/1000*player.rate;
    this.reset(player,position,this.context.currentTime+0.01);
  }}
  setMaster(value){this.master.gain.setTargetAtTime(clamp(value,0,1),this.context.currentTime,0.01);}
  setPcmLevel(value){
    this.pcmLevel=clamp(value,0,1);
    for(const player of this.players.values())player.pcmGain?.gain.setTargetAtTime(this.pcmLevel,this.context.currentTime,0.01);
  }
  setInstrumentBank(bank){
    if(bank===this.instrumentBank)return;
    this.instrumentBank=bank;const now=this.context.currentTime;
    // Re-chase current notes/controllers at the same transport position. The
    // application's Java music clock, sync callbacks and tempo remain untouched.
    for(const player of this.players.values())if(player.running){
      const position=Math.max(0,player.position+(now-player.anchor)*player.rate);
      if(player.duration<0||position<player.duration)this.reset(player,position,now+0.01);
    }
    this.pump();
  }
  load(id,events,duration) {
    this.close(id);const data=Float64Array.from(events);
    if(data.length%4||!Number.isFinite(duration))throw new Error('Invalid audio timeline');
    for(let i=0;i<data.length;i+=4)if(!Number.isFinite(data[i])||data[i]<0||(i&&data[i]<data[i-4]))throw new Error('Unordered audio timeline');
    this.players.set(id,{id,events:data,duration,samples:new Map(),pcm:new Map(),syncChannel:-1,syncKey:-1,
      running:false,rate:1,volume:1,position:0,wallStart:performance.now()});this.counters.loaded++;
  }
  sample(id,index,bytes) {
    const player=this.players.get(id);if(!player)return;
    try{player.samples.set(index,decodeWave(this.context,bytes));this.counters.samples++;}
    catch(error){this.errors.push('PCM '+index+': '+error);}
  }
  sync(id,channel,key){const player=this.players.get(id);if(player){player.syncChannel=channel;player.syncKey=key;}}
  control(id,command,position,rate,volume) {
    const player=this.players.get(id);if(!player)return;
    if(command===4){this.close(id);return;}
    player.volume=clamp(volume,0,1);
    if(command===3){player.gain?.gain.setTargetAtTime(player.volume,this.context.currentTime,0.01);return;}
    if(command===2){player.running=false;this.clearSound(player);return;}
    if(command===1) {
      if(!Number.isFinite(rate)||rate<=0||!Number.isFinite(position))throw new Error('Invalid audio transport');
      player.rate=rate;player.running=true;this.reset(player,Math.max(0,position),this.context.currentTime+0.01);this.pump();
    }
  }
  clearSound(player) {
    player.synth?.dispose();player.synth=null;
    for(const pcm of player.pcm.values())try{pcm.source.stop();}catch{}
    player.pcm.clear();player.pcmGain?.disconnect();player.pcmGain=null;player.gain?.disconnect();player.gain=null;
  }
  reset(player,position,when) {
    this.clearSound(player);player.position=position;player.wallStart=performance.now();player.anchor=when;
    player.lastPump=this.context.currentTime;player.ended=false;player.index=0;
    player.gain=this.context.createGain();player.gain.gain.value=player.volume;player.gain.connect(this.master);
    player.pcmGain=this.context.createGain();player.pcmGain.gain.value=this.pcmLevel;player.pcmGain.connect(player.gain);
    player.synth=new MidiSynth(this.context,player.gain,this.noise,this.counters,this.instrumentBank);
    const priorPcm=new Map(),events=player.events;
    while(player.index<events.length&&events[player.index]<position) {
      const i=player.index,time=events[i],status=events[i+1],a=events[i+2],b=events[i+3];player.index+=4;
      if(status===256){if(b>0)priorPcm.set(a,{time,velocity:b});else priorPcm.delete(a);}
      else if(status===257)priorPcm.clear();
      else if(!this.isSync(player,status,a))player.synth.message(status,a,b,when,true);
    }
    player.synth.chase();
    for(const [index,event] of priorPcm)this.playPcm(player,index,event.velocity,when,position-event.time);
  }
  isSync(player,status,key){return ((status&240)===0x90||(status&240)===0x80)&&(status&15)===player.syncChannel&&key===player.syncKey;}
  playPcm(player,index,velocity,when,offset=0) {
    const previous=player.pcm.get(index);if(previous)try{previous.source.stop(when);}catch{}
    player.pcm.delete(index);if(velocity<=0)return;
    const buffer=player.samples.get(index);if(!buffer||offset>=buffer.duration)return;
    const source=this.context.createBufferSource(),gain=this.context.createGain();source.buffer=buffer;
    source.playbackRate.value=player.rate;gain.gain.value=velocity/127;source.connect(gain);gain.connect(player.pcmGain);
    const active={source,gain};player.pcm.set(index,active);this.counters.pcm++;
    source.onended=()=>{source.disconnect();gain.disconnect();if(player.pcm.get(index)===active)player.pcm.delete(index);};
    source.start(when,offset);
  }
  pump(horizon=this.context.currentTime+0.1) {
    const now=this.context.currentTime;
    for(const player of this.players.values()) {
      if(!player.running||!player.synth||player.ended)continue;
      if(now-player.lastPump>0.25)this.reset(player,player.position+(now-player.anchor)*player.rate,now+0.01);
      player.lastPump=now;
      const limit=player.position+(horizon-player.anchor)*player.rate,events=player.events;
      while(player.index<events.length&&events[player.index]<=limit) {
        const i=player.index,time=events[i],status=events[i+1],a=events[i+2],b=events[i+3];player.index+=4;
        const when=Math.max(now,player.anchor+(time-player.position)/player.rate);
        if(status===256)this.playPcm(player,a,b,when);
        else if(status===257){for(const pcm of player.pcm.values())try{pcm.source.stop(when);}catch{}player.pcm.clear();}
        else if(!this.isSync(player,status,a))player.synth.message(status,a,b,when);
      }
      if(player.duration>=0&&limit>=player.duration) {
        const end=Math.max(now,player.anchor+(player.duration-player.position)/player.rate);
        player.synth.stop(end);for(const pcm of player.pcm.values())try{pcm.source.stop(end);}catch{}player.ended=true;
      }
    }
  }
  close(id){const player=this.players.get(id);if(player){this.clearSound(player);this.players.delete(id);}}
  stopAll(){for(const player of this.players.values()){player.running=false;this.clearSound(player);}}
  stats(){
    const samples=new Float32Array(this.analyser.fftSize);this.analyser.getFloatTimeDomainData(samples);
    return {...this.counters,state:this.context.state,players:this.players.size,instrument:this.instrumentBank?.format||'procedural',
      playing:[...this.players.values()].filter(player=>player.running).length,
      rms:Math.sqrt(samples.reduce((sum,value)=>sum+value*value,0)/samples.length),errors:[...this.errors]};
  }
  dispose(){clearInterval(this.timer);this.stopAll();this.players.clear();this.instrumentBank=null;this.master.disconnect();this.limiter.disconnect();this.analyser.disconnect();}
}
