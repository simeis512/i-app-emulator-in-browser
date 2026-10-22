// SPDX-License-Identifier: GPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { CLEAR, HeldKeys, PAD_DEFAULT, dialCodes, keycode, numpadArea, padWanted } from '../web/input.mjs';
test('keyboard keys map to DoJa codes and digits to their characters',()=>{
  assert.deepEqual(['ArrowUp','Enter',' ','x','Backspace','#','7','F1'].map(key=>keycode({key})),[-1,-5,-5,-7,CLEAR,35,55,undefined]);
});
test('the dial sends nothing at its centre, one code on an axis and two on a diagonal',()=>{
  assert.deepEqual(dialCodes(5,5,100,0),[]);
  assert.deepEqual(dialCodes(40,0,100,0),[-4]);
  assert.deepEqual(dialCodes(30,30,100,0),[-4,-2]);
  assert.deepEqual(dialCodes(0,-40,100,0),[-1]);
});
test('turning the handset turns the dial and the numeric keys with it',()=>{
  assert.deepEqual(dialCodes(40,0,100,-1),[-2]);
  assert.deepEqual(dialCodes(40,0,100,1),[-1]);
  assert.deepEqual([0,2,9].map(index=>numpadArea(index,0)),['','','']);
  assert.deepEqual([0,2,9].map(index=>numpadArea(index,-1)),['3/1','1/1','3/4']);
  assert.deepEqual([0,2,9].map(index=>numpadArea(index,1)),['1/4','3/4','1/1']);
});
test('a code shared by two sources is pressed once and released after the last',()=>{
  const held=new HeldKeys();
  assert.equal(held.press('keyboard:Enter',-5),true);
  assert.equal(held.press('keyboard:Enter',-5),false);
  assert.equal(held.press('keyboard:Space',-5),false);
  assert.equal(held.release('keyboard:Enter'),undefined);
  assert.equal(held.release('keyboard:Space'),-5);
  assert.equal(held.release('keyboard:Space'),undefined);
});
test('gamepad buttons and sticks become held sources under the button map',()=>{
  const pad={index:1,buttons:[{pressed:true},{pressed:false},{pressed:true}],axes:[-.8,.2]};
  assert.deepEqual([...padWanted([pad],PAD_DEFAULT)],[['pad1:b0',-5],['pad1:b2',-6],['pad1:a0',-3]]);
  assert.deepEqual([...padWanted([pad],{2:42})],[['pad1:b2',42],['pad1:a0',-3]]);
});
