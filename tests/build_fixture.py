# SPDX-License-Identifier: GPL-3.0-or-later
from pathlib import Path
import subprocess, zipfile, io, math, struct, wave
root=Path(__file__).resolve().parents[1]
output=root/'build/fixture';classes=output/'classes';classes.mkdir(parents=True,exist_ok=True)
subprocess.run(['javac','-J-Duser.language=en','--release','8','-encoding','UTF-8','-cp',str(root/'web/p905i-runtime.jar'),'-d',str(classes),str(root/'tests/TestIappli.java')],check=True)
track=bytearray(b'\x00\xff\x51\x03\x07\xa1\x20\x00\xc0\x08')
for key in [60,64,67,72]: track.extend(bytes([0,0x90,key,100,96,0x80,key,0]))
track.extend(b'\x00\xff\x2f\x00')
midi=b'MThd'+struct.pack('>IHHH',6,0,1,96)+b'MTrk'+struct.pack('>I',len(track))+track
pcm=io.BytesIO()
with wave.open(pcm,'wb') as wav:
    wav.setnchannels(1);wav.setsampwidth(2);wav.setframerate(22050)
    wav.writeframes(b''.join(struct.pack('<h',int(14000*math.sin(2*math.pi*660*i/22050))) for i in range(4410)))
with zipfile.ZipFile(output/'fixture.jar','w',zipfile.ZIP_DEFLATED) as z:
    for p in sorted(classes.rglob('*.class')):z.write(p,p.relative_to(classes).as_posix())
    z.writestr('fixture.mid',midi);z.writestr('fixture.wav',pcm.getvalue())
(output/'fixture.jam').write_text('AppName=Original Test Fixture\nAppClass=TestIappli\nSPsize=16\n',encoding='ascii')
(output/'fixture.sp').write_bytes((16).to_bytes(4,'big')+bytes(12))
print('Built original fixture in',output)
