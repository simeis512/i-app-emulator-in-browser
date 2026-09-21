// SPDX-License-Identifier: GPL-3.0-or-later
// Actual offline Web Audio rendering. All notes and PCM are authored test data.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
  try {
    const page=await browser.newPage();
    await page.route('https://cjrtnc.leaningtech.com/**',route=>route.abort());
    await page.goto(process.env.TEST_URL||'http://127.0.0.1:9052/');
    const {instrumentFixture}=await import(pathToFileURL(path.join(__dirname,'instrument-fixture.mjs')));
    const bankBytes=Array.from(instrumentFixture().bytes);
    const results=await page.evaluate(async bankBytes=>{
      const {BrowserAudio,decodeWave}=await import('./audio.mjs');
      const {parseInstrumentBank}=await import('./instruments.mjs');
      const bank=parseInstrumentBank(Uint8Array.from(bankBytes));
      const cases=[];
      const rms=(data,start,end)=>{const a=Math.floor(start*44100),b=Math.floor(end*44100);let sum=0;for(let i=a;i<b;i++)sum+=data[i]**2;return Math.sqrt(sum/(b-a));};
      const frequency=(data,start,end)=>{let count=0;for(let i=Math.floor(start*44100)+1;i<end*44100;i++)if(data[i-1]<=0&&data[i]>0)count++;return count/(end-start);};
      const pitchSpan=(data,start,end)=>{
        const crossings=[];for(let i=Math.floor(start*44100)+1;i<end*44100;i++)if(data[i-1]<=0&&data[i]>0)crossings.push(i-1-data[i-1]/(data[i]-data[i-1]));
        const pitches=crossings.slice(1).map((time,i)=>44100/(time-crossings[i]));return Math.max(...pitches)-Math.min(...pitches);
      };
      async function render(events,{position=0,rate=1,before,after,duration=0.9}={}) {
        const context=new OfflineAudioContext(2,44100,44100),audio=new BrowserAudio(context,{automatic:false});
        audio.setMaster(1);audio.load(1,events,duration);before?.(audio,context);
        audio.control(1,1,position,rate,1);audio.pump(1);after?.(audio);
        const data=(await context.startRendering()).getChannelData(0);
        const stats=audio.stats();audio.dispose();return {data,stats};
      }
      let result=await render([0,0xc0,8,0,0.02,0x90,69,100,0.6,0x80,69,0]);
      cases.push({name:'A4 pitch and note-off',ok:rms(result.data,.1,.4)>.001&&Math.abs(frequency(result.data,.1,.4)-440)<8&&rms(result.data,.8,.95)<1e-5});
      result=await render([0,0xc0,8,0,0,0x90,69,100,.3,0xe0,127,127,.7,0x80,69,0]);
      cases.push({name:'pitch bend raises A4 by two semitones',ok:Math.abs(frequency(result.data,.4,.6)-493.88)<10});
      result=await render([0,0xc0,8,0,0,0xb0,101,0,0,0xb0,100,0,0,0xb0,6,12,
        0,0xb0,101,127,0,0xb0,100,127,0,0xb0,6,1,0,0xe0,127,127,0,0x90,69,100,.7,0x80,69,0]);
      cases.push({name:'RPN sets octave bend range and deselection protects it',ok:Math.abs(frequency(result.data,.1,.5)-880)<10});
      result=await render([0,0xc0,8,0,0,0xb0,101,0,0,0xb0,100,0,0,0xe0,127,127,
        0,0x90,69,100,.3,0xb0,6,12,.7,0x80,69,0]);
      cases.push({name:'bend range changes affect already sounding notes',ok:Math.abs(frequency(result.data,.1,.25)-493.88)<10&&Math.abs(frequency(result.data,.4,.6)-880)<10});
      result=await render([0,0xc0,8,0,0,0xb0,101,0,0,0xb0,100,0,0,0xb0,6,12,
        0,0xe0,127,127,0,0x90,69,100,.8,0x80,69,0],{position:.2});
      cases.push({name:'seek restores non-default bend range',ok:Math.abs(frequency(result.data,.1,.4)-880)<10});
      result=await render([0,0xc0,8,0,0,0x90,69,100,.05,0xb0,1,127,.5,0xb0,1,0,.85,0x80,69,0]);
      cases.push({name:'modulation adds vibrato and zero restores steady pitch',ok:pitchSpan(result.data,.15,.45)>15&&pitchSpan(result.data,.65,.8)<2});
      result=await render([0,0x90,69,100,.1,0xb0,64,127,.2,0x80,69,0,.5,0xb0,64,0]);
      cases.push({name:'sustain holds until pedal release',ok:rms(result.data,.3,.4)>.001&&rms(result.data,.75,.9)<1e-5});
      result=await render([0,0xb0,7,0,0,0x90,69,100,.5,0x80,69,0],{position:.2});
      cases.push({name:'seek restores controller volume',ok:rms(result.data,.05,.4)<1e-5});
      result=await render([0,0x90,69,100,.6,0x80,69,0],{position:.3});
      cases.push({name:'seek restores an active note then releases it',ok:rms(result.data,.05,.2)>.001&&rms(result.data,.5,.7)<1e-5});
      result=await render([0,0xc0,8,0,0,0x90,69,100,.5,0x80,69,0],{rate:2});
      cases.push({name:'tempo rate changes duration without MIDI pitch shift',ok:Math.abs(frequency(result.data,.08,.23)-440)<10&&rms(result.data,.4,.6)<1e-5});
      result=await render([0,0x90,69,100,.6,0x80,69,0],{after:audio=>audio.control(1,2,0,1,1)});
      cases.push({name:'stop cancels scheduled future sound',ok:rms(result.data,.1,.8)<1e-5});
      result=await render([0,0x90,69,100,.6,0x80,69,0],{before:audio=>audio.sync(1,0,69)});
      cases.push({name:'DoJa sync notes are not synthesized',ok:rms(result.data,.1,.8)<1e-5});
      result=await render([0,0x99,36,127,.3,0x99,42,127]);
      cases.push({name:'procedural percussion creates a decaying signal',ok:rms(result.data,.04,.12)>.001&&rms(result.data,.7,.9)<1e-5});
      const wave=new Uint8Array(44+4410*2),view=new DataView(wave.buffer);
      const text=(offset,s)=>[...s].forEach((c,i)=>wave[offset+i]=c.charCodeAt(0));
      text(0,'RIFF');view.setUint32(4,wave.length-8,true);text(8,'WAVE');text(12,'fmt ');
      view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
      view.setUint32(24,44100,true);view.setUint32(28,88200,true);view.setUint16(32,2,true);view.setUint16(34,16,true);
      text(36,'data');view.setUint32(40,8820,true);
      for(let i=0;i<4410;i++)view.setInt16(44+2*i,Math.round(20000*Math.sin(2*Math.PI*660*i/44100)),true);
      result=await render([.1,256,0,100],{before:audio=>audio.sample(1,0,wave)});
      cases.push({name:'PCM sample has its expected frequency and ends',ok:result.stats.pcm===1&&Math.abs(frequency(result.data,.12,.19)-660)<20&&rms(result.data,.4,.8)<1e-5});
      let rejected=false;try{decodeWave(new OfflineAudioContext(1,100,44100),wave.subarray(0,50));}catch{rejected=true;}
      cases.push({name:'truncated PCM rejected',ok:rejected});
      const external=audio=>audio.setInstrumentBank(bank);
      result=await render([0,0x90,60,100,.6,0x80,60,0],{before:external});
      cases.push({name:'external bank loops its own 500 Hz wave and releases',ok:result.stats.bankNotes===1&&Math.abs(frequency(result.data,.1,.4)-500)<8&&rms(result.data,.85,.95)<1e-5});
      result=await render([0,0xc0,1,0,0,0x90,60,100,.6,0x80,60,0],{before:external});
      cases.push({name:'external program change selects a different waveform',ok:Math.abs(frequency(result.data,.1,.4)-1000)<8});
      result=await render([0,0x90,72,100,.6,0x80,72,0],{before:external});
      cases.push({name:'sample bank transposes up an octave',ok:Math.abs(frequency(result.data,.1,.4)-1000)<8});
      result=await render([0,0xb0,101,0,0,0xb0,100,0,0,0xb0,6,12,0,0xe0,127,127,0,0x90,60,100,.8,0x80,60,0],{before:external,position:.2});
      cases.push({name:'external bank seek restores held notes and pitch bend range',ok:Math.abs(frequency(result.data,.1,.4)-1000)<8});
      result=await render([0,0x90,60,100,.1,0xb0,64,127,.2,0x80,60,0,.5,0xb0,64,0],{before:external});
      cases.push({name:'external bank sustain and release work',ok:rms(result.data,.3,.4)>.001&&rms(result.data,.8,.9)<1e-5});
      result=await render([0,0x99,36,100,.6,0x89,36,0],{before:external});
      cases.push({name:'external percussion uses its fixed-pitch sample',ok:result.stats.bankNotes===1&&Math.abs(frequency(result.data,.1,.4)-500)<8});
      result=await render([0,0xc0,8,0,0,0x90,69,100,.6,0x80,69,0],{before:external});
      cases.push({name:'missing external instrument falls back to procedural synth',ok:result.stats.bankNotes===0&&result.stats.bankFallbacks===1&&Math.abs(frequency(result.data,.1,.4)-440)<8});
      result=await render([0,0xc0,3,0,0,0x90,69,100,.6,0x80,69,0],{before:external});
      cases.push({name:'unsupported native noise instrument falls back audibly',ok:result.stats.bankFallbacks===1&&rms(result.data,.1,.4)>.001});
      result=await render([0,0x90,60,100,.6,0x80,60,0],{before:external,after:audio=>audio.setInstrumentBank(null)});
      cases.push({name:'switching back cancels queued sampled voices',ok:result.stats.instrument==='procedural'&&Math.abs(frequency(result.data,.1,.4)-261.63)<8});
      result=await render([.1,256,0,100],{before:audio=>{external(audio);audio.sample(1,0,wave);}});
      cases.push({name:'application PCM effects still play with an external instrument bank',ok:result.stats.pcm===1&&Math.abs(frequency(result.data,.12,.19)-660)<20});
      return cases;
    },bankBytes);
    for(const result of results)console.log((result.ok?'PASS ':'FAIL ')+result.name);
    assert.ok(results.every(result=>result.ok),'audio render checks failed');
    // File picker and transaction semantics, without booting CheerpJ or using a
    // third-party bank. No requests may be sent by the bank selection itself.
    const requests=[];page.on('request',request=>requests.push(request.url()));
    await page.locator('.instrument-controls summary').click();
    await page.locator('#instrument-file').setInputFiles({name:'authored.bin',mimeType:'application/octet-stream',buffer:Buffer.from(bankBytes)});
    await page.waitForFunction(()=>document.querySelector('#instrument-status').textContent.includes('楽器 4'));
    await page.locator('#instrument-file').setInputFiles({name:'broken.bin',mimeType:'application/octet-stream',buffer:Buffer.from('broken')});
    await page.waitForFunction(()=>document.querySelector('#instrument-status').textContent.includes('現在の音色を継続: authored.bin'));
    await page.locator('#reset-instrument').click();
    assert.match(await page.locator('#instrument-status').textContent(),/標準の簡易音源を使用中/);
    await page.locator('#instrument-file').setInputFiles({name:'authored.bin',mimeType:'application/octet-stream',buffer:Buffer.from(bankBytes)});
    await page.waitForFunction(()=>document.querySelector('#instrument-status').textContent.includes('楽器 4'));
    assert.deepEqual(requests,[],'instrument selection must not send data or fetch a bank');
    await page.reload();
    assert.match(await page.locator('#instrument-status').textContent(),/標準の簡易音源を使用中/);
    assert.equal(await page.locator('#reset-instrument').isDisabled(),true);
    console.log('PASS external bank file picker, failed-load retention, reset, reload and no network request');
    console.log('ALL AUDIO RENDER CHECKS PASSED');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
