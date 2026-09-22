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
    // Turning the handset carried the dial with it, so the same spot sends a rotated direction.
    async function spot(fx,fy) {
      const ring=await page.locator('#dpad').boundingBox();
      await page.mouse.move(ring.x+ring.width*fx,ring.y+ring.height*fy);
      await page.mouse.down();await page.waitForTimeout(120);await page.mouse.up();
      await page.waitForTimeout(150);
    }
    await page.locator('#keypad-turn').selectOption('-1');
    assert.equal(await page.locator('#dpad i.left').textContent(),'↑');
    assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('.numpad button')).gridArea.split(' / ').slice(0,2).join(',')),'3,1');
    await spot(.08,.5);
    assert.deepEqual(await pixel(40,75),[120,210,255,255],'the left of a left-turned dial sends up');
    await spot(.92,.5);
    assert.deepEqual(await pixel(40,95),[120,210,255,255],'its right sends down again');
    await page.locator('#keypad-turn').selectOption('0');
    assert.equal(await page.locator('#dpad i.left').textContent(),'←');
    assert.equal((await save()).readInt32BE(0),36,'turning the keypad leaves the scratchpad alone');
    assert.deepEqual(errors,[]);
    console.log('PASS keypad turns with the handset, moving keys and directions together');

    console.log('Browser: reload and restore browser save over original SP');
    await page.route('**/__iapp/status',route=>route.fulfill({status:404,body:'Static host'}));
    await boot();
    await page.unroute('**/__iapp/status');
    console.log('PASS static host without a build-status endpoint still starts');
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
    console.log('ALL BROWSER CHECKS PASSED');
  } finally { await browser.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
