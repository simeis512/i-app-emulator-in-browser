// SPDX-License-Identifier: GPL-3.0-or-later
// Integration test with our own fixture only. Requires the local server and CDN access.
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const root = path.resolve(__dirname, '..');
const baseURL = process.env.TEST_URL || 'http://127.0.0.1:9052/';
const output = path.join(root, 'test-results');

async function main() {
  await fs.mkdir(output, {recursive:true});
  const browser = await chromium.launch({headless:true,
    ...(process.env.BROWSER_CHANNEL ? {channel:process.env.BROWSER_CHANNEL} : {})});
  try {
    // Separate ephemeral profile for this test; it never opens the user's games or saves.
    const context = await browser.newContext({viewport:{width:1280,height:900}});
    const page = await context.newPage();
    const errors = [], uploads = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('request', request => {
      if (new URL(request.url()).origin === new URL(baseURL).origin &&
          !['GET','HEAD','OPTIONS'].includes(request.method())) uploads.push(request.url());
    });
    async function boot(mode='2d') {
      await page.goto(baseURL);
      await page.locator('#renderer').selectOption(mode);
      await page.locator('#files').setInputFiles(['jar','jam','sp'].map(ext=>path.join(root,'build/fixture/fixture.'+ext)));
      await page.locator('#start').click();
      await page.waitForFunction(()=>window.iapp?.frames >= 5, null, {timeout:180000});
      assert.match(await page.evaluate(()=>window.iapp.getStatus()), /^FRAMES: /);
    }
    async function save() {
      return Buffer.from(await page.evaluate(()=>window.iapp.exportScratchpad()), 'base64');
    }
    async function pixel(x,y) {
      return page.evaluate(([x,y])=>Array.from(document.querySelector('#screen').getContext('2d').getImageData(x,y,1,1).data),[x,y]);
    }
    console.log('Browser: boot original 2D fixture');
    // A successful git pull must not make an old JAR look current.
    await page.route('**/__iapp/status',route=>route.fulfill({json:{app:'i-app-emulator-in-browser',builds:{runtime:{state:'stale'}}}}));
    await page.goto(baseURL);
    await page.locator('#files').setInputFiles(['jar','jam','sp'].map(ext=>path.join(root,'build/fixture/fixture.'+ext)));
    await page.locator('#start').click();
    await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('実行ファイルが古い'));
    assert.equal(await page.evaluate(()=>Boolean(window.iapp)),false,'old JAR must not start');
    await page.unroute('**/__iapp/status');
    console.log('PASS stale local build blocked with rebuild instructions');
    await page.evaluate(()=>{window.buzzes=[];navigator.vibrate=value=>{window.buzzes.push(value);return true;};});
    await page.locator('#test-haptics').click();
    assert.ok((await page.evaluate(()=>buzzes)).some(value=>value>100&&value<=200),'device test works before the JVM starts');
    assert.match(await page.locator('#haptics-note').textContent(),/実際の振動は検出できません/);
    await boot();
    await page.waitForFunction(()=>window.iapp.audioStats().rms>0.001);
    const initialAudio=await page.evaluate(()=>window.iapp.audioStats());
    assert.equal(initialAudio.state,'running');assert.ok(initialAudio.loaded>=2);
    assert.equal(initialAudio.instrument,'procedural');
    await page.keyboard.press('3');
    await page.waitForTimeout(250);
    assert.ok((await page.evaluate(()=>window.iapp.audioStats())).rms<0.0001,'application volume zero');
    await page.locator('#pcm-volume').fill('0');
    assert.equal(await page.locator('#pcm-volume-value').textContent(),'0%');
    await page.locator('#screen').focus();await page.keyboard.press('1');
    await page.waitForFunction(()=>iapp.audioStats().pcm>=1);await page.waitForTimeout(80);
    assert.ok((await page.evaluate(()=>iapp.audioStats())).rms<.0001,'PCM slider mutes the effect');
    await page.waitForTimeout(300);
    const mutedPcm=await page.evaluate(()=>iapp.audioStats().pcm);
    await page.locator('#pcm-volume').fill('25');
    assert.equal(await page.locator('#pcm-volume-value').textContent(),'25%');
    await page.locator('#screen').focus();
    await page.keyboard.press('1');
    await page.waitForFunction(count=>iapp.audioStats().pcm>count&&iapp.audioStats().rms>.001,mutedPcm);
    console.log('PASS PCM UI slider mutes and restores real Java-triggered effects');
    await page.waitForTimeout(300);
    const beforeAdpcm=await page.evaluate(()=>window.iapp.audioStats().pcm);
    for(let i=1;i<=3;i++){
      await page.keyboard.press('2');
      await page.waitForFunction(count=>window.iapp.audioStats().pcm>=count&&window.iapp.audioStats().rms>0.001,beforeAdpcm+i);
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout(450);
    assert.ok((await page.evaluate(()=>window.iapp.audioStats())).rms<0.0001,'ADPCM sample ends after rapid retriggering');
    console.log('PASS 2-bit MLD ADPCM waveform, repeated triggers and sample end');
    const beforeSharp=await page.evaluate(()=>iapp.audioStats().pcm);
    for(let i=1;i<=3;i++){
      await page.keyboard.press('7');
      await page.waitForFunction(count=>iapp.audioStats().pcm>=count&&iapp.audioStats().rms>.001,beforeSharp+i);
      await page.waitForTimeout(100);
    }
    await page.keyboard.press('8');await page.waitForTimeout(100);
    assert.ok((await page.evaluate(()=>iapp.audioStats())).rms<.0001,'SH pause stops the effect with BGM muted');
    await page.keyboard.press('9');await page.waitForFunction(()=>iapp.audioStats().rms>.001);
    await page.waitForTimeout(500);
    assert.ok((await page.evaluate(()=>iapp.audioStats())).rms<.0001,'SH effect ends after restart');
    console.log('PASS SH packet effect isolated from BGM, rapid triggers and pause/resume');
    const beforeNec=await page.evaluate(()=>iapp.audioStats().pcm);
    for(let i=1;i<=3;i++){
      await page.keyboard.press('0');
      await page.waitForFunction(count=>iapp.audioStats().pcm>=count&&iapp.audioStats().rms>.001,beforeNec+i);
      await page.waitForTimeout(100);
    }
    await page.waitForTimeout(600);
    assert.ok((await page.evaluate(()=>iapp.audioStats())).rms<.0001,'NEC stream ends after retrigger');
    console.log('PASS NEC stream waveform isolated from BGM, retrigger and sample end');
    await page.keyboard.press('4');
    await page.waitForFunction(()=>window.iapp.audioStats().rms>0.001);
    await page.keyboard.press('5');await page.waitForTimeout(300);
    assert.ok((await page.evaluate(()=>window.iapp.audioStats())).rms<0.0001,'pause silences voices');
    await page.keyboard.press('6');await page.waitForFunction(()=>window.iapp.audioStats().rms>0.001);
    await page.locator('#sound').uncheck();await page.waitForTimeout(250);
    assert.ok((await page.evaluate(()=>window.iapp.audioStats())).rms<0.0001,'UI mute');
    await page.locator('#sound').check();await page.waitForFunction(()=>window.iapp.audioStats().rms>0.001);
    await page.locator('#screen').focus();
    assert.deepEqual((await page.evaluate(()=>window.iapp.audioStats())).errors,[]);
    console.log('PASS audio waveform, PCM effect, app volume, pause/resume and UI mute');
    const {instrumentFixture}=await import(pathToFileURL(path.join(__dirname,'instrument-fixture.mjs')));
    const fixture=instrumentFixture();
    // The original Java fixture plays GM program 8; map it to our authored sine.
    new DataView(fixture.bytes.buffer).setUint16(fixture.offsets.groups[0]+1+8*2,0,true);
    await page.locator('.instrument-controls summary').click();
    await page.locator('#instrument-file').setInputFiles({name:'authored.bin',mimeType:'application/octet-stream',buffer:Buffer.from(fixture.bytes)});
    await page.waitForFunction(()=>iapp.audioStats().instrument==='FTRM v1'&&iapp.audioStats().bankNotes>0&&iapp.audioStats().rms>.001);
    await page.locator('#instrument-file').setInputFiles({name:'broken.bin',mimeType:'application/octet-stream',buffer:Buffer.from('broken')});
    await page.waitForFunction(()=>document.querySelector('#instrument-status').textContent.includes('現在の音色を継続'));
    assert.equal((await page.evaluate(()=>iapp.audioStats())).instrument,'FTRM v1');
    await page.locator('#reset-instrument').click();
    await page.waitForFunction(()=>iapp.audioStats().instrument==='procedural'&&iapp.audioStats().rms>.001);
    await page.locator('.instrument-controls summary').click();await page.locator('#screen').focus();
    assert.deepEqual((await page.evaluate(()=>iapp.audioStats())).errors,[]);
    console.log('PASS live instrument swap, malformed-bank retention and return to default');
    assert.equal((await save()).readInt32BE(0),16);
    assert.deepEqual(await pixel(20,95),[120,210,255,255]);
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(async()=>atob(await window.iapp.exportScratchpad()).charCodeAt(3)===36);
    await page.waitForFunction(()=>document.querySelector('#screen').getContext('2d').getImageData(40,95,1,1).data[0]===120);
    assert.deepEqual(await pixel(20,95),[17,34,51,255]);
    const downloading = page.waitForEvent('download');
    await page.locator('#export-save').click();
    const downloaded = await downloading;
    await downloaded.saveAs(path.join(output,'fixture-export.sp'));
    const bytes = await fs.readFile(path.join(output,'fixture-export.sp'));
    assert.equal(bytes.length,16);assert.equal(bytes.readInt32BE(0),36);
    await page.screenshot({path:path.join(output,'fixture-desktop.png'),fullPage:true});
    console.log('PASS keyboard, canvas pixels and raw SP download');
    // CLEAR travels outside the upstream key tables, so check it reaches the application.
    assert.deepEqual(await pixel(210,20),[17,34,51,255]);
    await page.locator('.keypad button[data-key="-8"]').click();
    await page.waitForFunction(()=>document.querySelector('#screen').getContext('2d').getImageData(210,20,1,1).data[1]===180);
    assert.deepEqual(await pixel(210,20),[255,180,60,255]);
    assert.equal((await save()).readInt32BE(0),36,'clear key leaves the scratchpad alone');
    const address=page.url();
    await page.locator('#screen').focus();await page.keyboard.press('Backspace');
    await page.waitForTimeout(150);
    assert.equal(page.url(),address,'Backspace must not navigate away');
    assert.deepEqual(errors,[]);
    console.log('PASS clear key from the keypad and Backspace, as a press and release pair');
    // The handset showed these below the screen, so they must not cover the application.
    await page.waitForFunction(()=>document.querySelector('#soft1').textContent==='メニュー');
    assert.equal(await page.locator('#soft2').textContent(),'終了');
    assert.ok(await page.locator('#soft-labels').isVisible());
    assert.deepEqual(await pixel(120,232),[17,34,51,255],'no label bar is drawn over the canvas');
    await page.locator('.numpad button[data-key="35"]').click();
    await page.waitForFunction(()=>document.querySelector('#soft1').textContent==='もどる');
    assert.equal(await page.locator('#soft2').textContent(),'終了');
    await page.locator('#screen').focus();
    console.log('PASS soft key labels appear below the screen and follow the application');
    // Glass gives nothing back, so a press and an application's own vibration must reach the device.
    await page.evaluate(()=>{window.buzzes=[];navigator.vibrate=value=>{window.buzzes.push(value);return true;};});
    await page.locator('.numpad button[data-key="49"]').click();
    const pulses=await page.evaluate(()=>buzzes);
    assert.ok(pulses.length>0,'a key press answers with a pulse');
    assert.ok(pulses.every(value=>value>=20),'the pulse is long enough for a motor to answer');
    await page.evaluate(()=>{window.buzzes=[];});
    await page.locator('#screen').focus();await page.keyboard.press('ArrowUp');
    assert.ok((await page.evaluate(()=>buzzes)).some(value=>value>0&&value<=25),'keyboard input also gives a pulse');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('x');await page.waitForTimeout(350);
    const stoppedFrames=await page.evaluate(()=>iapp.frames);
    await page.evaluate(()=>{window.buzzes=[];});
    await page.locator('#screen').focus();await page.keyboard.press('*');
    await page.waitForFunction(()=>buzzes.some(value=>value>=1000));
    assert.equal(await page.evaluate(()=>iapp.frames),stoppedFrames,'app vibration works while repainting is stopped');
    await page.keyboard.press('*');
    await page.waitForFunction(()=>buzzes.includes(0));
    await page.keyboard.press('x');
    console.log('PASS keyboard/touch pulses and app vibration without repaint reach the browser API');
    // A pad with a motor of its own should answer alongside the handset.
    await page.evaluate(()=>{
      window.rumbles=[];
      const pad=window.hapticPad={index:0,id:'authored pad',mapping:'standard',buttons:[{pressed:false}],axes:[],
        vibrationActuator:{playEffect:(kind,options)=>{window.rumbles.push([kind,options.duration]);return Promise.resolve();},reset(){}}};
      window.realPads=navigator.getGamepads;navigator.getGamepads=()=>[pad];
    });
    await page.locator('.numpad button[data-key="50"]').click();
    const rumbles=await page.evaluate(()=>rumbles);
    assert.ok(rumbles.length>0&&rumbles.every(([kind,duration])=>kind==='dual-rumble'&&duration>=20),
      'a connected pad rumbles with the same press');
    await page.evaluate(()=>{rumbles.length=0;hapticPad.buttons[0].pressed=true;});
    await page.waitForFunction(()=>rumbles.length>0);
    await page.evaluate(()=>{hapticPad.buttons[0].pressed=false;});
    await page.waitForTimeout(50);
    await page.evaluate(()=>{navigator.getGamepads=window.realPads;});
    console.log('PASS a gamepad with a motor rumbles alongside the handset');
    // A locked screen or another tab has to fall silent.
    await page.waitForFunction(()=>iapp.audioStats().rms>.001);
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{value:true,configurable:true});
      document.dispatchEvent(new Event('visibilitychange'));});
    // A suspended context produces nothing; its analyser still holds the last buffer it saw.
    await page.waitForFunction(()=>iapp.audioStats().state==='suspended');
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{value:false,configurable:true});
      document.dispatchEvent(new Event('visibilitychange'));});
    await page.waitForFunction(()=>iapp.audioStats().state==='running'&&iapp.audioStats().rms>.001);
    console.log('PASS audio stops while the page is hidden and returns with it');
    // Which layout suits a device is its owner's call, so the switch works anywhere.
    assert.ok(await page.locator('#play-tools').isVisible(),'the switch is offered on a desktop too');
    const sizes={};
    await page.locator('#leave-play').click();
    await page.waitForFunction(()=>document.body.classList.contains('playing'));
    assert.ok(!await page.locator('#start').isVisible(),'play mode puts the settings away');
    sizes.viewer=await page.evaluate(()=>document.querySelector('.viewer').getBoundingClientRect().height);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1),
      'play mode fits the whole window');
    await page.locator('#show-keypad').click();
    await page.waitForFunction(()=>document.body.classList.contains('no-keypad'));
    assert.ok(!await page.locator('.keypad').isVisible(),'a keyboard or pad makes the keys optional');
    sizes.bare=await page.evaluate(()=>document.querySelector('.viewer').getBoundingClientRect().height);
    assert.ok(sizes.bare>sizes.viewer,'the screen area takes the height the keys leave');
    await page.locator('#show-keypad').click();
    await page.waitForFunction(()=>!document.body.classList.contains('no-keypad'));
    await page.locator('#leave-play').click();
    await page.waitForFunction(()=>!document.body.classList.contains('playing'));
    await page.locator('#screen').focus();
    console.log('PASS play mode and the on-screen keys switch on any device');
    // Turning the handset carried the dial with it, so the same spot sends a rotated direction.
    async function spot(fx,fy) {
      await page.locator('#dpad').scrollIntoViewIfNeeded();
      const ring=await page.locator('#dpad').boundingBox();
      await page.mouse.move(ring.x+ring.width*fx,ring.y+ring.height*fy);
      await page.mouse.down();await page.waitForTimeout(120);await page.mouse.up();
      await page.waitForTimeout(150);
    }
    await page.locator('#keypad-turn').selectOption('-1');
    // The printed arrows still point outward; only the key behind each one changes.
    assert.equal(await page.locator('#dpad i.left').textContent(),'←');
    assert.equal(await page.locator('#dpad i.left').getAttribute('data-code'),'-1');
    assert.match(await page.evaluate(()=>getComputedStyle(document.querySelector('.numpad .cap')).transform),
      /matrix\(-?0(\.\d+)?, -1, 1, /,'the legends turn with the keys');
    // Handset keys are wide and short, so a turned one has to stand taller than it is wide.
    const shape=await page.evaluate(()=>{const r=document.querySelector('.numpad button').getBoundingClientRect();
      return {w:r.width,h:r.height};});
    assert.ok(shape.h>shape.w*1.4,'a turned key stands taller than it is wide');
    const rows=await page.evaluate(()=>{const middle=s=>{const r=document.querySelector(s).getBoundingClientRect();return r.top+r.height/2;};
      return {dial:middle('.dpad'),soft1:middle('.soft1'),soft2:middle('.soft2'),clear:middle('.clear')};});
    assert.ok(Math.abs(rows.dial-(rows.soft1+rows.soft2)/2)<2&&Math.abs(rows.dial-rows.clear)<2,
      'the dial sits level with the middle of the keys beside it');
    assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('.numpad button')).gridArea.split(' / ').slice(0,2).join(',')),'3,1');
    await spot(.08,.5);
    assert.deepEqual(await pixel(40,75),[120,210,255,255],'the left of a left-turned dial sends up');
    await spot(.92,.5);
    assert.deepEqual(await pixel(40,95),[120,210,255,255],'its right sends down again');
    await page.locator('#keypad-turn').selectOption('0');
    assert.equal(await page.locator('#dpad i.left').getAttribute('data-code'),'-3');
    assert.equal((await save()).readInt32BE(0),36,'turning the keypad leaves the scratchpad alone');
    assert.deepEqual(errors,[]);
    console.log('PASS keypad turns with the handset, moving keys and directions together');

    console.log('Browser: reload and restore browser save over original SP');
    await page.route('**/__iapp/status',route=>route.fulfill({status:404,body:'Static host'}));
    await boot('auto');
    await page.unroute('**/__iapp/status');
    console.log('PASS static host without a build-status endpoint still starts');
    assert.equal(await page.evaluate(()=>iapp.renderer),'2d','an application without OpenGL ES classes keeps the Java 8 runtime');
    assert.match(await page.locator('#renderer option[value="auto"]').textContent(),/2D$/);
    assert.equal(await page.locator('#warning').isHidden(),true);
    console.log('PASS automatic renderer choice reads the JAR and keeps 2D');
    assert.equal((await page.evaluate(()=>iapp.audioStats())).instrument,'procedural');
    assert.equal((await save()).readInt32BE(0),36);
    assert.deepEqual(await pixel(40,95),[120,210,255,255]);
    await page.setViewportSize({width:390,height:844});
    await page.waitForFunction(()=>document.body.classList.contains('playing'));
    await page.screenshot({path:path.join(output,'fixture-mobile.png'),fullPage:true});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    // A phone has to reach the keypad without scrolling the screen out of view.
    const layout=await page.evaluate(()=>{
      const screen=document.querySelector('#screen').getBoundingClientRect();
      const pad=document.querySelector('.keypad').getBoundingClientRect();
      return {top:screen.top,width:screen.width,height:screen.height,padTop:pad.top,padBottom:pad.bottom,
        inner:innerHeight,scroll:document.documentElement.scrollHeight};
    });
    assert.ok(layout.top>=0&&layout.padBottom<=layout.inner+1,'screen and keypad share one screenful');
    assert.ok(layout.padTop>=layout.top+layout.height-1,'the keypad sits below the screen');
    assert.ok(layout.width>=240,'the screen is scaled up to the available width');
    assert.ok(layout.scroll<=layout.inner+1,'play mode does not scroll the page');
    // A handset dial is a ring, so a diagonal has to send both directions at once.
    await page.locator('#dpad').scrollIntoViewIfNeeded();
    const dial=await page.locator('#dpad').boundingBox();
    const centre=[dial.x+dial.width/2,dial.y+dial.height/2],reach=dial.width*.4;
    async function press(dx,dy) {
      await page.mouse.move(centre[0]+dx*reach,centre[1]+dy*reach);
      await page.mouse.down();await page.waitForTimeout(120);await page.mouse.up();
      await page.waitForTimeout(120);
    }
    assert.deepEqual(await pixel(60,75),[17,34,51,255]);
    await press(.707,-.707);
    assert.deepEqual(await pixel(60,75),[120,210,255,255],'up and right arrive together');
    assert.deepEqual(await pixel(40,95),[17,34,51,255]);
    await press(-.707,.707);
    assert.deepEqual(await pixel(40,95),[120,210,255,255],'down and left arrive together');
    assert.equal((await save()).readInt32BE(0),36,'the diagonals cancel out again');
    await press(1,0);
    await page.waitForFunction(async()=>atob(await window.iapp.exportScratchpad()).charCodeAt(3)===56);
    await press(-1,0);
    await page.waitForFunction(async()=>atob(await window.iapp.exportScratchpad()).charCodeAt(3)===36);
    assert.deepEqual(errors,[]);
    console.log('PASS ring dial sends single directions and diagonals');
    await page.locator('#leave-play').click();
    await page.waitForFunction(()=>!document.body.classList.contains('playing'));
    assert.ok(await page.locator('#start').isVisible(),'leaving play mode shows the settings again');
    await page.locator('#leave-play').click();
    await page.waitForFunction(()=>document.body.classList.contains('playing'));
    // A phone turned sideways is wide but short, so width alone must not decide the layout.
    await page.setViewportSize({width:844,height:390});
    await page.waitForTimeout(300);
    const turned=await page.evaluate(()=>({playing:document.body.classList.contains('playing'),
      padBottom:document.querySelector('.keypad').getBoundingClientRect().bottom,
      inner:innerHeight,scroll:document.documentElement.scrollHeight}));
    assert.ok(turned.playing,'a sideways phone stays in play mode');
    assert.ok(turned.padBottom<=turned.inner+1&&turned.scroll<=turned.inner+1,'sideways still needs no scrolling');
    // The bar between the two bands sets their share, and the keys fill whatever they get.
    const band=()=>page.evaluate(()=>({screen:document.querySelector('.viewer').getBoundingClientRect().height,
      keys:document.querySelector('.controls').getBoundingClientRect().height,
      scale:Number(getComputedStyle(document.querySelector('.keypad')).transform.split('(')[1].split(',')[0])}));
    const before=await band();
    const bar=await page.locator('#split').boundingBox();
    await page.mouse.move(bar.x+bar.width/2,bar.y+bar.height/2);
    await page.mouse.down();
    await page.mouse.move(bar.x+bar.width/2,bar.y+bar.height/2-140,{steps:6});
    await page.mouse.up();
    await page.waitForTimeout(200);
    const after=await band();
    assert.ok(after.screen<before.screen-60,'dragging the bar up hands height to the keys');
    assert.ok(after.keys>before.keys+60,'the keys band takes it');
    assert.ok(after.scale>before.scale,'the keys grow into the room without changing shape');
    // Scaled keys that outgrow their band get their edges clipped away, so check they fit.
    const held=await page.evaluate(()=>{const keys=document.querySelector('.keypad').getBoundingClientRect(),
      band=document.querySelector('.controls').getBoundingClientRect();
      return {top:keys.top-band.top,bottom:band.bottom-keys.bottom,left:keys.left-band.left,right:band.right-keys.right};});
    assert.ok(held.top>=-.5&&held.bottom>=-.5&&held.left>=-.5&&held.right>=-.5,
      'the keys stay inside their band rather than being clipped');
    await page.locator('#split').focus();
    await page.keyboard.press('ArrowDown');await page.waitForTimeout(150);
    assert.ok((await band()).screen>after.screen,'arrow keys move the bar too');
    await page.locator('#screen').focus();
    console.log('PASS the divider shares the height and the keys scale to fill theirs');
    await page.setViewportSize({width:390,height:844});
    await page.waitForFunction(()=>document.body.classList.contains('playing'));
    console.log('PASS play mode keeps screen and keypad visible upright and sideways');
    assert.deepEqual(uploads,[]);assert.deepEqual(errors,[]);
    console.log('PASS persistent save reload, mobile layout and no local upload');

    console.log('Browser: boot with Java 17 and optional OGL adapter');
    await boot('ogl');
    await page.waitForFunction(()=>window.iapp.audioStats().rms>0.001);
    await page.keyboard.press('3');await page.waitForTimeout(250);
    await page.keyboard.press('2');
    await page.waitForFunction(()=>window.iapp.audioStats().pcm>=1&&window.iapp.audioStats().rms>0.001);
    assert.deepEqual((await page.evaluate(()=>window.iapp.audioStats())).errors,[]);
    console.log('PASS Java 17 2-bit ADPCM waveform');
    await page.waitForTimeout(500);
    const sharp17=await page.evaluate(()=>iapp.audioStats().pcm);
    await page.keyboard.press('7');
    await page.waitForFunction(count=>iapp.audioStats().pcm>count&&iapp.audioStats().rms>.001,sharp17);
    console.log('PASS Java 17 SH packet waveform with BGM muted');
    await page.waitForTimeout(500);
    const nec17=await page.evaluate(()=>iapp.audioStats().pcm);
    await page.keyboard.press('0');
    await page.waitForFunction(count=>iapp.audioStats().pcm>count&&iapp.audioStats().rms>.001,nec17);
    console.log('PASS Java 17 NEC stream waveform with BGM muted');
    assert.equal((await save()).readInt32BE(0),36);
    assert.deepEqual(await pixel(40,95),[120,210,255,255]);
    assert.deepEqual(errors,[]);
    // A folding phone opened out is wide, but still a touch device needing the play layout.
    const wide=await browser.newContext({viewport:{width:1000,height:700},hasTouch:true,isMobile:true});
    const folded=await wide.newPage();
    await folded.goto(baseURL);
    await folded.locator('#files').setInputFiles(['jar','jam','sp'].map(ext=>path.join(root,'build/fixture/fixture.'+ext)));
    await folded.locator('#start').click();
    await folded.waitForFunction(()=>window.iapp?.frames>=5,null,{timeout:180000});
    await folded.waitForFunction(()=>document.body.classList.contains('playing'));
    assert.ok(await folded.locator('#full-screen').isVisible(),'the whole screen is offered where bars steal room');
    await wide.close();
    console.log('PASS a wide touch screen still gets the play layout');

    console.log('Browser: experimental WebGL2 renderer against the software one');
    // The same original 3D frames in both renderers. Interiors must match; only triangle edges may differ, because
    // the GPU applies its own fill rule where the software rasteriser includes every pixel on an edge. Each scene
    // lists points inside its shapes, including where one shape must hide, show through or cover another.
    const scenes=[
      {key:'1',name:'colours, shading, clipping and viewports',points:[[10,8],[120,20],[60,76],[180,60],[180,170],[20,190],[120,230]]},
      {key:'2',name:'depth tests, depth writes and clears',
        points:[[36,30],[90,90],[120,108],[48,66],[78,66],[150,90],[174,66],[204,36],[36,204],[78,162],[175,205],[120,20]]},
    ];
    const pictures={ogl:[],webgl:[]},logs={};
    for(const mode of ['ogl','webgl']) {
      const tab=await browser.newPage({viewport:{width:1200,height:1000}});const failures=[];
      tab.on('pageerror',error=>failures.push(String(error)));
      await tab.goto(baseURL);await tab.locator('#renderer').selectOption(mode);
      await tab.locator('#files').setInputFiles(['jar','jam'].map(ext=>path.join(root,'build/fixture/ogl.'+ext)));
      await tab.locator('#start').click();
      await tab.waitForFunction(()=>window.iapp?.frames>=5,null,{timeout:180000});
      for(const scene of scenes) {
        const before=await tab.evaluate(()=>iapp.frames);
        await tab.keyboard.press(scene.key);
        await tab.waitForFunction(count=>iapp.frames>=count+3,before);
        pictures[mode].push(await tab.evaluate(()=>{const c=document.querySelector('#screen');
          return {width:c.width,data:Array.from(c.getContext('2d').getImageData(0,0,c.width,c.height).data)};}));
      }
      // The log panel refreshes once a second.
      await tab.waitForFunction(line=>document.querySelector('#log').textContent.includes(line),
        mode==='webgl'?'experimental WebGL2 renderer':'Loading I-Appli');
      logs[mode]=await tab.locator('#log').textContent();
      assert.deepEqual(failures,[]);await tab.close();
    }
    assert.match(logs.webgl,/experimental WebGL2 renderer/);
    const at=(p,x,y)=>p.data.slice((y*p.width+x)*4,(y*p.width+x)*4+3);
    scenes.forEach((scene,i)=>{
      const soft=pictures.ogl[i],gpu=pictures.webgl[i];
      for(const [x,y] of scene.points)assert.deepEqual(at(gpu,x,y),at(soft,x,y),`scene ${scene.key}, pixel ${x},${y}`);
      let edges=0;
      for(let k=0;k<soft.data.length;k+=4)
        if(Math.max(...[0,1,2].map(c=>Math.abs(soft.data[k+c]-gpu.data[k+c])))>2)edges++;
      assert.ok(edges<soft.data.length/4/200,`scene ${scene.key}: ${edges} pixels differ, more than triangle edges explain`);
      console.log(`PASS WebGL2 draws ${scene.name} as software does, apart from ${edges} edge pixels`);
    });
    console.log('ALL BROWSER CHECKS PASSED');
  } finally { await browser.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
