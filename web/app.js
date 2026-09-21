// SPDX-License-Identifier: GPL-3.0-or-later
import { addFiles, prepareApplication } from './loader.mjs';
import { BrowserAudio } from './audio.mjs';
const $ = id => document.getElementById(id);
const canvas = $('screen'), ctx = canvas.getContext('2d', { alpha:false });
let files = {}, runtime, application, booted = false, preparing = false;
let frames = 0, imageData, polling = false, fpsFrames = 0, fpsTime = performance.now();
let audio;
function audioLevel(){return $('sound').checked?Number($('volume').value)/100:0;}
async function prepareAudio() {
  try {
    if(!audio)audio=new BrowserAudio(new AudioContext({latencyHint:'interactive'}));
    audio.setMaster(audioLevel());await audio.resume();
    $('audio-status').textContent=$('sound').checked?'音声ON · 簡易音源':'消音';
  }catch(error){$('audio-status').textContent='音声を開始できません: '+error.message;}
}
$('sound').onchange=()=>{if(audio)prepareAudio();};
$('volume').oninput=()=>{if(audio)audio.setMaster(audioLevel());$('volume-value').textContent=$('volume').value+'%';};
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
  $('resolution').textContent=`${canvas.width} × ${canvas.height}`;
}
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
      async Java_p905i_web_BrowserRuntime_present(lib,pixels,width,height) {
        if(width!==canvas.width || height!==canvas.height) {
          canvas.width=width;canvas.height=height;imageData=ctx.createImageData(width,height);
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
    canvas.focus();
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
  button.onpointerdown=e=>{e.preventDefault();button.setPointerCapture(e.pointerId);key('pointer:'+e.pointerId,code,true);};
  button.onpointerup=button.onpointercancel=button.onlostpointercapture=e=>key('pointer:'+e.pointerId,code,false);
}
function keycode(e) {
  const map={ArrowUp:-1,ArrowDown:-2,ArrowLeft:-3,ArrowRight:-4,Enter:-5,' ':-5,z:-6,Z:-6,x:-7,X:-7,'*':42,'#':35};
  return /^[0-9]$/.test(e.key)?e.key.charCodeAt(0):map[e.key];
}
document.addEventListener('keydown',e=>{
  if(['SELECT','INPUT','TEXTAREA'].includes(e.target.tagName)||e.ctrlKey||e.altKey||e.metaKey)return;
  const code=keycode(e);if(code!==undefined && runtime){e.preventDefault();key('keyboard:'+e.code,code,true);}
});
document.addEventListener('keyup',e=>key('keyboard:'+e.code,keycode(e),false));
function release(){for(const [source,code] of [...sources])key(source,code,false);}
window.addEventListener('blur',release);document.addEventListener('visibilitychange',()=>{if(document.hidden)release();});
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
