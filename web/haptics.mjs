// SPDX-License-Identifier: GPL-3.0-or-later
export class BrowserHaptics {
  constructor(nav=globalThis.navigator,report=()=>{},timers=globalThis) {
    this.nav=nav;this.report=report;this.timers=timers;this.enabled=true;this.visible=true;
    this.appOn=false;this.until=0;this.timer=null;this.serial=0;
  }
  pads(){try{return [...(this.nav.getGamepads?.()||[])].filter(p=>p?.vibrationActuator?.playEffect);}catch{return [];}}
  pulse(milliseconds=25) {
    if(!this.enabled||!this.visible||this.appOn)return;
    this.until=Math.max(this.until,Date.now()+milliseconds);this.refresh();
  }
  application(on){on=Boolean(on);if(on===this.appOn)return;this.appOn=on;this.refresh();}
  setEnabled(on){this.enabled=on;if(!on)this.until=0;this.refresh();}
  setVisible(on){this.visible=on;if(!on)this.until=0;this.refresh();}
  stop(){this.appOn=false;this.until=0;this.refresh();}
  refresh() {
    this.timers.clearTimeout(this.timer);this.timer=null;
    const serial=++this.serial;
    if(!this.enabled||!this.visible) {
      this.cancel();this.report(this.enabled?'ページが非表示のため振動を停止中です。':'振動はOFFです。');return;
    }
    const duration=this.appOn?1500:Math.max(0,this.until-Date.now());
    if(!duration){this.cancel();return;}
    const messages=[],show=()=>{if(serial===this.serial)this.report(messages.join(' / '));};
    // A true return value confirms acceptance, not the presence or movement of a motor.
    if(typeof this.nav.vibrate==='function') {
      try {messages.push(this.nav.vibrate(duration)?'端末: 要求受付（実際の振動は検出できません）':
        '端末: 要求を拒否。画面をタップしてから再試行してください');}
      catch(error){messages.push('端末: 実行できません（'+(error.name||'エラー')+'）');}
    }else messages.push('端末: このブラウザは振動APIに対応していません');
    for(const pad of this.pads()) {
      const index=messages.length;messages.push('ゲームパッド: 要求送信');
      const result=text=>{messages[index]='ゲームパッド: '+text;show();};
      try {
        Promise.resolve(pad.vibrationActuator.playEffect('dual-rumble',{duration,
          strongMagnitude:duration>200?.9:.6,weakMagnitude:duration>200?.54:.36}))
          .then(value=>result(value==='complete'?'完了（実際の振動は検出できません）':
            value==='preempted'?'中断されました':'受付結果を確認できません'),
            error=>result('実行できません（'+(error?.name||'エラー')+'）'));
      }catch(error){result('実行できません（'+(error.name||'エラー')+'）');}
    }
    show();
    if(this.appOn)this.timer=this.timers.setTimeout(()=>this.refresh(),1400);
  }
  cancel() {
    if(typeof this.nav.vibrate==='function')try{this.nav.vibrate(0);}catch{}
    for(const pad of this.pads())try{Promise.resolve(pad.vibrationActuator.reset?.()).catch(()=>{});}catch{}
  }
}
