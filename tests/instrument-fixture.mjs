// SPDX-License-Identifier: GPL-3.0-or-later
// Entirely authored fixture: mathematical sine waves and invented parameters.
// No bytes are copied from third-party sound banks.
export function instrumentFixture(){
  const output=[];
  const u8=n=>output.push(n&255),u16=n=>{u8(n);u8(n>>8);},u32=n=>{u16(n);u16(n>>>16);};
  u32(0x4d525446);u16(1);u16(3);u16(5);u16(2);
  for(let i=0;i<4;i++)u16(0); // Tables unused by this reader.
  const offsets={samples:[],zones:[],groups:[]};
  for(let i=0;i<3;i++){
    offsets.samples.push(output.length);u16(1024);u8(60);u8(i===2?1:0);u32(0);u32(256);u32(256);
    for(let n=0;n<256;n++)u8(Math.round(100*Math.sin(2*Math.PI*n/(i===1?32:64))));
  }
  const zone=(sample,high=127,fixed=-1)=>{
    offsets.zones.push(output.length);u16(sample);u16(0xffff);
    const raw=new Uint8Array(68),v=new DataView(raw.buffer);
    v.setInt8(0,high);v.setInt16(12,511,true);v.setInt8(20,32);
    v.setInt16(40,2047,true);v.setInt16(42,2047,true);v.setInt16(44,1600,true);v.setInt8(47,31);
    v.setInt32(60,fixed,true);for(const n of [...raw.slice(0,4),...raw.slice(12)])u8(n);
  };
  for(let i=0;i<5;i++){
    u8(0);u8(127);u8(i===2?2:1);
    if(i===2){zone(0,59);zone(1);}else zone(i===3?2:i===1?1:0,127,i===4?60:-1);
  }
  for(const id of [0x79,0x78]){
    offsets.groups.push(output.length);u8(id);
    for(let i=0;i<128;i++)u16(id===0x79&&i<4?i:id===0x78&&i===36?4:0xffff);
  }
  return {bytes:Uint8Array.from(output),offsets};
}
