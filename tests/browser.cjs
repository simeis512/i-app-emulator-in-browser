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

    console.log('Browser: reload and restore browser save over original SP');
    await page.route('**/__iapp/status',route=>route.fulfill({status:404,body:'Static host'}));
    await boot();
    await page.unroute('**/__iapp/status');
    console.log('PASS static host without a build-status endpoint still starts');
    assert.equal((await page.evaluate(()=>iapp.audioStats())).instrument,'procedural');
    assert.equal((await save()).readInt32BE(0),36);
    assert.deepEqual(await pixel(40,95),[120,210,255,255]);
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:path.join(output,'fixture-mobile.png'),fullPage:true});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
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
