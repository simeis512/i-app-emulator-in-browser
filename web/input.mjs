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
