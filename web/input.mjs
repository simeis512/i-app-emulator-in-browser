// SPDX-License-Identifier: GPL-3.0-or-later
// Key codes the runtime takes from keyboards, the on-screen dial and gamepads.
// CLEAR has no place in the upstream key tables; the runtime delivers it separately.
export const CLEAR = -8;
// Clockwise from the right, matching the screen angle of a press.
export const DIAL=[[-4],[-4,-2],[-2],[-3,-2],[-3],[-3,-1],[-1],[-4,-1]];
export function keycode(e) {
  const map={ArrowUp:-1,ArrowDown:-2,ArrowLeft:-3,ArrowRight:-4,Enter:-5,' ':-5,z:-6,Z:-6,x:-7,X:-7,
    Backspace:CLEAR,'*':42,'#':35};
  return /^[0-9]$/.test(e.key)?e.key.charCodeAt(0):map[e.key];
}
export const PAD_DEFAULT={0:-5,1:CLEAR,2:-6,3:-7,4:42,5:35,8:49,9:51,12:-1,13:-2,14:-3,15:-4};
export const PAD_AXES={0:[-3,-4],1:[-1,-2]};
export const PAD_LEARN=[[-5,'決定'],[CLEAR,'クリア'],[-6,'左ソフト'],[-7,'右ソフト'],[-1,'↑'],[-2,'↓'],
  [-3,'←'],[-4,'→'],[42,'＊'],[35,'＃'],[49,'1'],[51,'3']];
// Turning the handset moves every key with it, so the dial sends the rotated direction.
export const turnShift=turn=>turn===0?0:turn<0?2:6;
// Codes for a press at (x, y) from the dial's centre; the centre itself sends nothing.
export function dialCodes(x,y,width,turn) {
  if(Math.hypot(x,y)<width*.24)return [];
  const index=((Math.round(Math.atan2(y,x)*4/Math.PI)%8)+8)%8;
  return DIAL[(index+turnShift(turn))%8];
}
// Grid area of the numeric key at index (row by row from 1) once the handset is turned.
export function numpadArea(index,turn) {
  const row=Math.floor(index/3)+1,column=index%3+1;
  return turn===0?'':turn<0?`${4-column}/${row}`:`${column}/${5-row}`;
}
// Track physical sources, not just numeric codes (Enter and Space share a code).
export class HeldKeys {
  constructor(){this.sources=new Map();}
  // Whether the runtime should hear the press: not a repeat, and the code is not already held elsewhere.
  press(source,code) {
    if(this.sources.has(source))return false;
    const held=[...this.sources.values()].includes(code);this.sources.set(source,code);return !held;
  }
  // The code to release, or undefined while the source was not held or another source still holds it.
  release(source) {
    if(!this.sources.has(source))return undefined;
    const code=this.sources.get(source);this.sources.delete(source);
    return [...this.sources.values()].includes(code)?undefined:code;
  }
}
// Sources and codes the connected gamepads hold under the given button map.
export function padWanted(pads,map) {
  const wanted=new Map();
  for(const pad of pads) {
    pad.buttons.forEach((button,index)=>{
      if(button.pressed&&map[index]!==undefined)wanted.set(`pad${pad.index}:b${index}`,map[index]);
    });
    for(const [axis,[low,high]] of Object.entries(PAD_AXES)) {
      const value=pad.axes[axis]??0,source=`pad${pad.index}:a${axis}`;
      if(value<=-.5)wanted.set(source,low);else if(value>=.5)wanted.set(source,high);
    }
  }
  return wanted;
}
