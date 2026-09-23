// SPDX-License-Identifier: GPL-3.0-or-later
import { addFiles, prepareApplication } from './loader.mjs';
import { BrowserAudio } from './audio.mjs';
import { readInstrumentFile } from './instruments.mjs';
const $ = id => document.getElementById(id);
// CLEAR has no place in the upstream key tables; the runtime delivers it separately.
const CLEAR = -8;
const canvas = $('screen'), ctx = canvas.getContext('2d', { alpha:false });
let files = {}, runtime, application, booted = false, preparing = false;
let frames = 0, imageData, polling = false, fpsFrames = 0, fpsTime = performance.now();
let audio,instrumentBank=null,instrumentName='',instrumentRequest=0;
function audioLevel(){return $('sound').checked?Number($('volume').value)/100:0;}
function showAudioStatus(){
  $('audio-status').textContent=$('sound').checked?
    (instrumentBank?'音声ON · 外部音色（近似再生）':'音声ON · 標準の簡易音源'):'消音';
}
async function prepareAudio() {
  try {
    if(!audio){audio=new BrowserAudio(new AudioContext({latencyHint:'interactive'}));audio.setInstrumentBank(instrumentBank);}
    audio.setMaster(audioLevel());audio.setPcmLevel(Number($('pcm-volume').value)/100);await audio.resume();
    showAudioStatus();
  }catch(error){$('audio-status').textContent='音声を開始できません: '+error.message;}
}
$('sound').onchange=()=>{if(audio)prepareAudio();else showAudioStatus();};
$('volume').oninput=()=>{if(audio)audio.setMaster(audioLevel());$('volume-value').textContent=$('volume').value+'%';};
$('pcm-volume').oninput=()=>{audio?.setPcmLevel(Number($('pcm-volume').value)/100);$('pcm-volume-value').textContent=$('pcm-volume').value+'%';};
$('instrument-file').onchange=async event=>{
  const file=event.target.files[0];event.target.value='';if(!file)return;
  const request=++instrumentRequest;$('instrument-status').textContent='音色ファイルを読み込んでいます…';
  $('reset-instrument').disabled=false;
  try{
    const bank=await readInstrumentFile(file);if(request!==instrumentRequest)return;
    audio?.setInstrumentBank(bank);instrumentBank=bank;instrumentName=file.name;
    $('instrument-status').textContent=`${instrumentName} · 楽器 ${bank.programCount} / 打楽器 ${bank.drumCount}。未対応の音色は標準音源で補います。`;
    showAudioStatus();
  }catch(error){
    if(request!==instrumentRequest)return;
    $('instrument-status').textContent=error.message+' '+(instrumentBank?`現在の音色を継続: ${instrumentName}`:'標準の簡易音源を継続します。');
  }finally{if(request===instrumentRequest)$('reset-instrument').disabled=!instrumentBank;}
};
$('reset-instrument').onclick=()=>{
  ++instrumentRequest;audio?.setInstrumentBank(null);instrumentBank=null;instrumentName='';
  $('instrument-status').textContent='標準の簡易音源を使用中';$('reset-instrument').disabled=true;showAudioStatus();
};
window.addEventListener('pagehide',()=>audio?.dispose());
// CheerpJ permits one JS-to-Java entry call at a time. Input, status polling and
// save downloads must share a queue, including when a key is still being handled.
let javaQueue=Promise.resolve();
function javaCall(operation) {
  const result=javaQueue.then(operation);javaQueue=result.catch(()=>{});return result;
}
function status(text, error=false) { $('status').textContent=text; $('status').classList.toggle('error',error); }
function chooseSize() {
  [canvas.width,canvas.height]=$('size').value.split(',').map(Number);
  imageData=ctx.createImageData(canvas.width,canvas.height);
  $('resolution').textContent=`${canvas.width} × ${canvas.height}`;fitScreen();
}
// Play mode sizes the canvas from the free area, so the keypad stays on screen.
function fitScreen(){canvas.style.setProperty('--aspect',canvas.width/canvas.height);}
const PHONE='(pointer:coarse),(max-width:750px),(max-height:560px)';
const narrow=()=>matchMedia(PHONE).matches;
// Which layout suits a device is its owner's call, so the switch is always there.
function setPlaying(on) {
  document.body.classList.toggle('playing',on);
  $('leave-play').textContent=on?'設定':'プレイ画面';
  $('play-tools').hidden=!booted;$('show-keypad').hidden=!on;
  fitKeypad();
}
$('leave-play').onclick=()=>setPlaying(!document.body.classList.contains('playing'));
// A keyboard or a gamepad makes the on-screen keys dead weight, so they can go.
let keypadOff=false;
try{keypadOff=localStorage.getItem('keypadOff')==='1';}catch{}
function setKeypad(shown) {
  keypadOff=!shown;document.body.classList.toggle('no-keypad',keypadOff);
  $('show-keypad').textContent=keypadOff?'キー表示':'キー非表示';
  try{localStorage.setItem('keypadOff',keypadOff?'1':'0');}catch{}
}
$('show-keypad').onclick=()=>{release();setKeypad(keypadOff);fitKeypad();};
// The screen and the keys split the height; the bar between them sets the share,
// and each side scales to fill its own band without changing shape.
const padArea=document.querySelector('.controls'),padKeys=document.querySelector('.keypad');
let share=62;
try{share=Math.min(90,Math.max(20,Number(localStorage.getItem('playShare'))||62));}catch{}
function fitKeypad() {
  if(!document.body.classList.contains('playing')) {
    padKeys.classList.remove('wide');delete padKeys.dataset.wide;
    return padKeys.style.removeProperty('--pad-scale');
  }
  // Keep the handset's own stacking while it stays comfortable, and only fall back
  // to the two halves side by side when a wide, short band would leave it tiny.
  // clientWidth and clientHeight include the padding, which would scale the keys past
  // the band and let the edges be clipped, so measure the content box itself.
  const box=getComputedStyle(padArea);
  const room=[padArea.clientWidth-parseFloat(box.paddingLeft)-parseFloat(box.paddingRight),
              padArea.clientHeight-parseFloat(box.paddingTop)-parseFloat(box.paddingBottom)];
  const fit=wide=>{
    padKeys.classList.toggle('wide',wide);
    const width=padKeys.offsetWidth,height=padKeys.offsetHeight;
    return width&&height?Math.min(room[0]/width,room[1]/height):0;
  };
  const stacked=fit(false),side=fit(true);
  // Leave a gap between the two thresholds so dragging the bar cannot flip it back and forth.
  const wide=side>stacked&&stacked<(padKeys.dataset.wide?.7:.6);
  padKeys.classList.toggle('wide',wide);
  if(wide)padKeys.dataset.wide='1';else delete padKeys.dataset.wide;
  const scale=wide?side:stacked;
  if(scale>0)padKeys.style.setProperty('--pad-scale',scale);
}
function applyShare() {
  document.body.style.setProperty('--screen',share);
  document.body.style.setProperty('--keys',100-share);
  fitKeypad();
}
function saveShare(){try{localStorage.setItem('playShare',String(share));}catch{}}
function moveSplit(clientY) {
  const box=document.querySelector('.workspace').getBoundingClientRect();
  if(!box.height)return;
  share=Math.round(Math.min(90,Math.max(20,(clientY-box.top)/box.height*100)));
  applyShare();
}
$('split').onpointerdown=e=>{
  e.preventDefault();$('split').setPointerCapture(e.pointerId);$('split').classList.add('dragging');moveSplit(e.clientY);
};
$('split').onpointermove=e=>{if($('split').hasPointerCapture(e.pointerId))moveSplit(e.clientY);};
$('split').onpointerup=$('split').onpointercancel=()=>{$('split').classList.remove('dragging');saveShare();};
$('split').onkeydown=e=>{
  const step=e.key==='ArrowUp'?-3:e.key==='ArrowDown'?3:0;
  if(!step)return;
  e.preventDefault();share=Math.min(90,Math.max(20,share+step));applyShare();saveShare();
};
new ResizeObserver(fitKeypad).observe(padArea);
setKeypad(!keypadOff);applyShare();
// A browser's own bars leave little room sideways, so offer the whole screen.
$('full-screen').hidden=!document.documentElement.requestFullscreen;
$('full-screen').onclick=async()=>{
  try {
    if(document.fullscreenElement)await document.exitFullscreen();
    else await document.documentElement.requestFullscreen({navigationUI:'hide'});
  }catch(error){status('全画面にできません: '+(error.message||error),true);}
};
document.addEventListener('fullscreenchange',()=>{$('full-screen').textContent=document.fullscreenElement?'全画面解除':'全画面';});
// Keys on glass give nothing back, so answer a press the way the handset did.
const canBuzz=typeof navigator.vibrate==='function';
let appBuzz=0;
if(!canBuzz){$('haptics').checked=false;$('haptics').disabled=true;$('haptics-note').textContent='この端末・ブラウザは振動に対応していません。';}
// A pulse this short never reaches the motor on most handsets, so a key needs a real one.
const TAP=25;
function buzz(milliseconds){
  if(!canBuzz||!$('haptics').checked)return;
  // A browser that declines says so; report it rather than leaving a dead setting.
  try{if(navigator.vibrate(milliseconds)===false)$('haptics-note').textContent='ブラウザが振動を実行しませんでした。端末のマナーモードや振動の設定を確認してください。';}
  catch(error){$('haptics-note').textContent='振動を実行できません: '+(error.message||error);}
}
function appVibrate(on) {
  clearInterval(appBuzz);appBuzz=0;
  if(!on||!canBuzz||!$('haptics').checked){if(canBuzz)try{navigator.vibrate(0);}catch{}return;}
  buzz(1500);appBuzz=setInterval(()=>buzz(1500),1400);
}
$('haptics').onchange=()=>{if(!$('haptics').checked)appVibrate(0);};
matchMedia(PHONE).addEventListener('change',event=>{if(event.matches&&booted)setPlaying(true);});
chooseSize(); $('size').onchange=chooseSize;
function selectFiles(incoming) {
  if(booted || preparing) return;
  try { files=addFiles(files,incoming); renderFiles(); status('ファイルを選択しました。画面サイズと描画モードを確認して起動してください。'); }
  catch(error) { status(error.message,true); }
}
function renderFiles() {
  $('file-list').replaceChildren();
  for(const [ext,file] of Object.entries(files)) {
    const li=document.createElement('li');li.textContent=`${ext.toUpperCase()}: ${file.name} (${file.size.toLocaleString()} bytes)`;
    $('file-list').append(li);
  }
}
$('files').onchange=e=>{selectFiles([...e.target.files]);e.target.value='';};
$('clear-files').onclick=()=>{files={};renderFiles();status('JARとJAMを選択してください。');};
for(const type of ['dragover','drop']) document.addEventListener(type,e=>e.preventDefault());
$('dropzone').ondragover=e=>{e.preventDefault();e.dataTransfer.dropEffect='copy';};
$('dropzone').ondrop=e=>{e.preventDefault();selectFiles([...e.dataTransfer.files]);};
function lockInputs(locked) {
  for(const id of ['files','clear-files','size','renderer']) $(id).disabled=locked;
}

async function start() {
  if(preparing) return;
  preparing=true;$('start').disabled=true;lockInputs(true);
  // Create/resume the AudioContext within this explicit button gesture.
  const audioReady=prepareAudio();
  try {
    await audioReady;
    status('ファイルを検証しています…');
    application=await prepareApplication(files);
    $('warning').textContent=application.warning;$('warning').hidden=!application.warning;
    const ogl=$('renderer').value==='ogl';
    // The local server can compare JAR fingerprints with the current sources.
    // Static hosting has no such endpoint; its prebuilt distribution still works.
    let localBuilds;
    try {
      const response=await fetch('/__iapp/status',{cache:'no-store'});
      if(response.ok){const info=await response.json();if(info.app==='i-app-emulator-in-browser')localBuilds=info.builds;}
    }catch{}
    for(const component of ['runtime',...(ogl?['ogl']:[])]){
      if(localBuilds?.[component]&&localBuilds[component].state!=='current')
        throw new Error('実行ファイルが古いか、ビルド情報を確認できません。python build.py と python build_ogl.py を成功させてから再読み込みしてください。git pull や serve.py だけでは更新されません。');
    }
    // Make missing build products actionable before initializing a one-shot JVM.
    for(const name of ['p905i-runtime.jar',...(ogl?['p905i-ogl.jar']:[])]) {
      const response=await fetch(name,{method:'HEAD'});
      if(!response.ok) throw new Error('エミュレーターが未ビルドです。説明書のビルド手順を実行してください。');
    }
    if(typeof cheerpjInit!=='function') throw new Error('実行環境を取得できません。インターネット接続を確認してください。');
    booted=true;$('app-name').textContent=application.name;
    status('Java実行環境を準備しています…');
    await cheerpjInit({version:ogl?17:8,status:'none',javaProperties:['file.encoding=Shift_JIS'],
      natives:{
      async Java_p905i_web_BrowserAudio_loadNative(lib,id,events,duration){audio?.load(id,events,duration);},
      async Java_p905i_web_BrowserAudio_sampleNative(lib,id,index,bytes){audio?.sample(id,index,bytes);},
      async Java_p905i_web_BrowserAudio_controlNative(lib,id,command,position,rate,volume){audio?.control(id,command,position,rate,volume);},
      async Java_p905i_web_BrowserAudio_syncNative(lib,id,channel,key){audio?.sync(id,channel,key);},
      async Java_p905i_web_BrowserRuntime_vibrate(lib,on){appVibrate(on);},
      async Java_p905i_web_BrowserRuntime_softLabels(lib,utf8) {
        const [left='',right='']=new TextDecoder().decode(Uint8Array.from(utf8)).split(String.fromCharCode(10));
        $('soft1').textContent=left;$('soft2').textContent=right;
        $('soft-labels').hidden=!left&&!right;
      },
      async Java_p905i_web_BrowserRuntime_present(lib,pixels,width,height) {
        if(width!==canvas.width || height!==canvas.height) {
          canvas.width=width;canvas.height=height;imageData=ctx.createImageData(width,height);
          $('resolution').textContent=`${width} × ${height}`;fitScreen();
        }
        const rgba=imageData.data;
        for(let i=0,j=0;i<pixels.length;i++,j+=4) {
          const p=pixels[i];rgba[j]=(p>>>16)&255;rgba[j+1]=(p>>>8)&255;rgba[j+2]=p&255;rgba[j+3]=255;
        }
        ctx.putImageData(imageData,0,0);frames++;
        $('frame-count').textContent=`${frames} frames`;$('screenshot').disabled=false;
      }}
    });
    for(const ext of ['jar','jam','sp']) cheerpOSAddStringFile(`/str/app.${ext}`,application[ext]);
    const base='/app'+new URL('.',location.href).pathname;
    const lib=await cheerpjRunLibrary((ogl?base+'p905i-ogl.jar:':'')+base+'p905i-runtime.jar');
    runtime=await lib.p905i.web.BrowserRuntime;
    $('log').textContent=application.warning;
    await javaCall(()=>runtime.start('/str/app.jar','/str/app.jam','/str/app.sp',`/files/iapp/${application.id}`,canvas.width,canvas.height,true));
    window.iapp={get frames(){return frames;},id:application.id,
      audioStats:()=>audio?.stats(),
      getStatus:()=>javaCall(()=>runtime.getStatus()),
      exportScratchpad:()=>javaCall(()=>runtime.exportScratchpad())};
    $('export-save').disabled=application.sizes.length===0;
    $('start').textContent='再起動（再読み込み）';$('start').disabled=false;
    setInterval(async()=>{
      if(polling)return;polling=true;
      try {
        const [state,log]=await javaCall(async()=>[await runtime.getStatus(),await runtime.getLog()]);
        if(state.startsWith('ERROR:'))status(`未対応の処理で停止: ${state.slice(7)}`,true);
        else if(state==='TERMINATED')status('アプリが終了しました。再起動できます。');
        else status(frames?'実行中 · 操作キーで進めてください。':'起動処理中…');
        if(state==='TERMINATED'||state.startsWith('ERROR:'))audio?.stopAll();
        if(audio?.errors.length)$('audio-status').textContent='一部の音声を再生できません（実行ログを参照）';
        $('log').textContent=(application.warning?application.warning+'\n':'')+log+
          (audio?.errors.length?'\n'+audio.errors.join('\n'):'');
        const now=performance.now();$('fps').textContent=`${((frames-fpsFrames)*1000/(now-fpsTime)).toFixed(1)} fps`;
        fpsFrames=frames;fpsTime=now;
      }catch(error){status(String(error),true);}finally{polling=false;}
    },1000);
    setPlaying(narrow());canvas.focus();
  }catch(error) {
    status(error.message||String(error),true);console.error(error);
    $('start').textContent=booted?'再読み込み':'起動する';$('start').disabled=false;
    if(!booted)lockInputs(false);
  }finally{preparing=false;}
}
$('start').onclick=()=>booted?location.reload():start();

// Track physical sources, not just numeric codes (Enter and Space share a code).
const sources=new Map();
function key(source,code,down) {
  if(!runtime)return;
  if(down) {
    if(sources.has(source))return;
    const held=[...sources.values()].includes(code);sources.set(source,code);if(held)return;
  } else {
    if(!sources.has(source))return;
    code=sources.get(source);sources.delete(source);if([...sources.values()].includes(code))return;
  }
  for(const button of document.querySelectorAll(`[data-key="${code}"]`))button.classList.toggle('pressed',down);
  javaCall(()=>runtime.key(code,down)).catch(error=>status(String(error),true));
}
for(const button of document.querySelectorAll('[data-key]')) {
  const code=Number(button.dataset.key);
  button.onpointerdown=e=>{e.preventDefault();button.setPointerCapture(e.pointerId);buzz(TAP);key('pointer:'+e.pointerId,code,true);};
  button.onpointerup=button.onpointercancel=button.onlostpointercapture=e=>key('pointer:'+e.pointerId,code,false);
}
// A handset dial is a ring: the outer band sends a direction and a diagonal sends two.
const dpad=$('dpad');
// Clockwise from the right, matching the screen angle of a press.
const DIAL=[[-4],[-4,-2],[-2],[-3,-2],[-3],[-3,-1],[-1],[-4,-1]];
const SPOT=['right','down','left','up'];
let keypadTurn=0;
// Legends were printed on the keys, so turning the handset turns them with it.
for(const button of document.querySelectorAll('.keypad button')) {
  const cap=document.createElement('span');cap.className='cap';cap.append(...button.childNodes);button.append(cap);
}
// Turning the handset moves every key with it, so the dial sends the rotated direction.
const turnShift=()=>keypadTurn===0?0:keypadTurn<0?2:6;
function applyTurn() {
  // The arrows stay printed outward; turning changes which key each position is.
  for(let index=0;index<4;index++)
    dpad.querySelector('i.'+SPOT[index]).dataset.code=DIAL[(index*2+turnShift())%8][0];
  for(const element of [document.querySelector('.keypad'),document.body]) {
    element.classList.toggle('turn-left',keypadTurn<0);element.classList.toggle('turn-right',keypadTurn>0);
  }
  const numpad=document.querySelector('.numpad');
  [...numpad.children].forEach((button,index)=>{
    const row=Math.floor(index/3)+1,column=index%3+1;
    button.style.gridArea=keypadTurn===0?'':keypadTurn<0?`${4-column}/${row}`:`${column}/${5-row}`;
  });
  try{localStorage.setItem('keypadTurn',String(keypadTurn));}catch{}
  fitKeypad();
}
try{keypadTurn=Number(localStorage.getItem('keypadTurn'))||0;}catch{}
$('keypad-turn').value=String(keypadTurn);
$('keypad-turn').onchange=()=>{release();keypadTurn=Number($('keypad-turn').value);applyTurn();};
applyTurn();
function dpadAim(event) {
  const box=dpad.getBoundingClientRect(),x=event.clientX-box.left-box.width/2,y=event.clientY-box.top-box.height/2;
  if(Math.hypot(x,y)<box.width*.24)return [];
  const index=((Math.round(Math.atan2(y,x)*4/Math.PI)%8)+8)%8;
  return DIAL[(index+turnShift())%8];
}
function dpadShow(codes) {
  for(const glyph of dpad.querySelectorAll('i'))glyph.classList.toggle('on',codes.includes(Number(glyph.dataset.code)));
}
function dpadSet(pointer,codes) {
  // One source per axis, so a diagonal holds both without either cancelling the other.
  for(const [axis,wanted] of [['h',codes.find(code=>code===-3||code===-4)],['v',codes.find(code=>code===-1||code===-2)]]) {
    const source=`dpad${pointer}:${axis}`,held=sources.get(source);
    if(held!==undefined&&held!==wanted)key(source,held,false);
    if(wanted!==undefined&&held!==wanted)key(source,wanted,true);
  }
  if(codes.length&&String(codes)!==dpadLast)buzz(TAP);
  dpadLast=String(codes);dpadShow(codes);
}
let dpadLast='';
dpad.onpointerdown=e=>{
  if(e.target.closest('button'))return;
  e.preventDefault();dpad.setPointerCapture(e.pointerId);dpadSet(e.pointerId,dpadAim(e));
};
dpad.onpointermove=e=>{if(dpad.hasPointerCapture(e.pointerId))dpadSet(e.pointerId,dpadAim(e));};
dpad.onpointerup=dpad.onpointercancel=dpad.onlostpointercapture=e=>dpadSet(e.pointerId,[]);
function keycode(e) {
  const map={ArrowUp:-1,ArrowDown:-2,ArrowLeft:-3,ArrowRight:-4,Enter:-5,' ':-5,z:-6,Z:-6,x:-7,X:-7,
    Backspace:CLEAR,'*':42,'#':35};
  return /^[0-9]$/.test(e.key)?e.key.charCodeAt(0):map[e.key];
}
document.addEventListener('keydown',e=>{
  if(['SELECT','INPUT','TEXTAREA'].includes(e.target.tagName)||e.target===$('split')||e.ctrlKey||e.altKey||e.metaKey)return;
  const code=keycode(e);if(code!==undefined && runtime){e.preventDefault();key('keyboard:'+e.code,code,true);}
});
document.addEventListener('keyup',e=>key('keyboard:'+e.code,keycode(e),false));
function release(){for(const [source,code] of [...sources])key(source,code,false);padRelease();dpadShow([]);}
window.addEventListener('blur',release);
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){release();appVibrate(0);audio?.suspend();}
  else if($('sound').checked)audio?.resume();
});

// Gamepads feed the same key() path as touch and keyboard, so a held key stays consistent.
const PAD_DEFAULT={0:-5,1:CLEAR,2:-6,3:-7,4:42,5:35,8:49,9:51,12:-1,13:-2,14:-3,15:-4};
const PAD_AXES={0:[-3,-4],1:[-1,-2]};
const PAD_LEARN=[[-5,'決定'],[CLEAR,'クリア'],[-6,'左ソフト'],[-7,'右ソフト'],[-1,'↑'],[-2,'↓'],
  [-3,'←'],[-4,'→'],[42,'＊'],[35,'＃'],[49,'1'],[51,'3']];
let padMap={...PAD_DEFAULT},padHeld=new Map(),padLearn=-1,padPrev=new Set();
try{const saved=localStorage.getItem('padMap');if(saved)padMap={...PAD_DEFAULT,...JSON.parse(saved)};}catch{}
function padSave(){try{localStorage.setItem('padMap',JSON.stringify(padMap));}catch{}}
function pads(){return [...(navigator.getGamepads?.()||[])].filter(Boolean);}
function padPressed(){const set=new Set();for(const pad of pads())pad.buttons.forEach((b,i)=>{if(b.pressed)set.add(i);});return set;}
function padStatus() {
  const list=pads();
  $('pad-status').textContent=list.length?
    list.map(pad=>pad.id+(pad.mapping==='standard'?'':'（標準配置ではありません）')).join(' / '):
    '接続されていません。ボタンを押すと認識します。';
  $('pad-remap').disabled=$('pad-reset').disabled=!list.length;
}
function padWanted() {
  const wanted=new Map();
  for(const pad of pads()) {
    pad.buttons.forEach((button,index)=>{
      if(button.pressed&&padMap[index]!==undefined)wanted.set(`pad${pad.index}:b${index}`,padMap[index]);
    });
    for(const [axis,[low,high]] of Object.entries(PAD_AXES)) {
      const value=pad.axes[axis]??0,source=`pad${pad.index}:a${axis}`;
      if(value<=-.5)wanted.set(source,low);else if(value>=.5)wanted.set(source,high);
    }
  }
  return wanted;
}
function padAsk(){$('pad-remap-status').hidden=false;$('pad-remap-status').textContent=`「${PAD_LEARN[padLearn][1]}」に割り当てるボタンを押してください。`;}
function padStopLearn(message) {
  padLearn=-1;$('pad-remap').textContent='割り当てを変更';
  $('pad-remap-status').textContent=message;$('pad-remap-status').hidden=!message;
}
function padLearnStep() {
  // Assign on a new press, so holding one button cannot fill several entries.
  const pressed=padPressed(),fresh=[...pressed].find(index=>!padPrev.has(index));padPrev=pressed;
  if(fresh===undefined)return;
  const code=PAD_LEARN[padLearn][0];
  for(const index of Object.keys(padMap))if(padMap[index]===code)delete padMap[index];
  padMap[fresh]=code;padSave();padLearn++;
  if(padLearn>=PAD_LEARN.length)padStopLearn('割り当てを保存しました。');else padAsk();
}
function padPoll() {
  requestAnimationFrame(padPoll);
  if(padLearn>=0){padLearnStep();return;}
  const wanted=padWanted();
  for(const [source,code] of padHeld)if(wanted.get(source)!==code)key(source,code,false);
  for(const [source,code] of wanted)if(padHeld.get(source)!==code)key(source,code,true);
  padHeld=wanted;
}
function padRelease(){for(const [source,code] of padHeld)key(source,code,false);padHeld=new Map();}
$('pad-remap').onclick=()=>{
  if(padLearn>=0){padStopLearn('変更を中止しました。押した分は保存されています。');return;}
  padRelease();padLearn=0;padPrev=padPressed();$('pad-remap').textContent='中止';padAsk();
};
$('pad-reset').onclick=()=>{padMap={...PAD_DEFAULT};padSave();padStopLearn('標準の割り当てに戻しました。');};
for(const type of ['gamepadconnected','gamepaddisconnected'])
  window.addEventListener(type,()=>{padRelease();padStatus();});
padStatus();requestAnimationFrame(padPoll);
function download(blob,name) {
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
$('screenshot').onclick=()=>canvas.toBlob(blob=>{if(blob)download(blob,'iapp-screen.png');},'image/png');
$('export-save').onclick=async()=>{
  $('export-save').disabled=true;
  try {
    const encoded=await javaCall(()=>runtime.exportScratchpad());
    const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
    download(new Blob([bytes],{type:'application/octet-stream'}),`iapp-${application.id.slice(0,12)}.sp`);
  }catch(error){status('SPの書き出しに失敗: '+error,true);}
  finally{$('export-save').disabled=false;}
};
