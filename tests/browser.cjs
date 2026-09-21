// SPDX-License-Identifier: GPL-3.0-or-later
// Integration test with our own fixture only. Requires the local server and CDN access.
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
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
    await boot();
    await page.waitForFunction(()=>window.iapp.audioStats().rms>0.001);
    const initialAudio=await page.evaluate(()=>window.iapp.audioStats());
    assert.equal(initialAudio.state,'running');assert.ok(initialAudio.loaded>=2);
    await page.keyboard.press('3');
    await page.waitForTimeout(250);
    assert.ok((await page.evaluate(()=>window.iapp.audioStats())).rms<0.0001,'application volume zero');
    await page.keyboard.press('1');
    await page.waitForFunction(()=>window.iapp.audioStats().pcm>=1&&window.iapp.audioStats().rms>0.001);
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
    await boot();
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
    assert.equal((await save()).readInt32BE(0),36);
    assert.deepEqual(await pixel(40,95),[120,210,255,255]);
    assert.deepEqual(errors,[]);
    console.log('ALL BROWSER CHECKS PASSED');
  } finally { await browser.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
