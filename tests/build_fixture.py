# SPDX-License-Identifier: GPL-3.0-or-later
from pathlib import Path
import os, subprocess, zipfile, io, math, struct, wave
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
# Original packed test codes in a minimal MFi ADAT container (not game audio).
adat=struct.pack('>HBB',11,0x81,0)+b'adpm'+struct.pack('>HBBB',3,16,2,1)+bytes((i*37+19)&255 for i in range(1600))
events=bytes([0,0x7f,0x80,0x3f,96,0xff,0xdf,0])
body=struct.pack('>HBBB',11,1,1,1)+b'ainf'+struct.pack('>HBB',2,1,0)
body+=b'adat'+struct.pack('>I',len(adat))+adat+b'trac'+struct.pack('>I',len(events))+events
mld=b'melo'+struct.pack('>I',len(body))+body
# Authored SH single-packet ADPCM effect; no extracted wave/packet is reused.
codes=bytes((i*37+19)&255 for i in range(1600))
packet=bytes([0x71,0x84,0,0x45,0])+struct.pack('>I',len(codes))+codes
sharp_events=bytes([1,0xff,0xff])+struct.pack('>H',len(packet))+packet+bytes([96,0xff,0xdf,0])
sharp_body=struct.pack('>HBBB',3,1,1,1)+b'trac'+struct.pack('>I',len(sharp_events))+sharp_events
sharp_mld=b'melo'+struct.pack('>I',len(sharp_body))+sharp_body
# Authored NEC mono Yamaha stream, registered separately from StreamOn.
nec_packet=bytes([0x11,1,0xf0,7,0,1])+struct.pack('>H',8000)+codes[:-1]
nec_on=bytes([0x11,1,0xf1,3,0,100])
nec_events=b''.join(bytes([1,0xff,0xff])+struct.pack('>H',len(p))+p for p in [nec_packet,nec_on])+bytes([96,0xff,0xdf,0])
nec_body=struct.pack('>HBBB',3,1,1,1)+b'trac'+struct.pack('>I',len(nec_events))+nec_events
nec_mld=b'melo'+struct.pack('>I',len(nec_body))+nec_body
with zipfile.ZipFile(output/'fixture.jar','w',zipfile.ZIP_DEFLATED) as z:
    for p in sorted(classes.rglob('*.class')):z.write(p,p.relative_to(classes).as_posix())
    z.writestr('fixture.mid',midi);z.writestr('fixture.wav',pcm.getvalue())
    z.writestr('fixture.mld',mld)
    z.writestr('sharp.mld',sharp_mld)
    z.writestr('nec.mld',nec_mld)
(output/'fixture.jam').write_text('AppName=Original Test Fixture\nAppClass=TestIappli\nSPsize=16\n',encoding='ascii')
(output/'fixture.sp').write_bytes((16).to_bytes(4,'big')+bytes(12))
# The 3D fixture runs on the Java 17 OpenGL ES adapter, so it is compiled against that JAR.
classes3d=output/'classes-ogl';classes3d.mkdir(parents=True,exist_ok=True)
classpath=str(root/'web/p905i-ogl.jar')+os.pathsep+str(root/'web/p905i-runtime.jar')
subprocess.run(['javac','-J-Duser.language=en','--release','17','-encoding','UTF-8','-cp',classpath,'-d',str(classes3d),str(root/'tests/TestOgl.java')],check=True)
with zipfile.ZipFile(output/'ogl.jar','w',zipfile.ZIP_DEFLATED) as z:
    for p in sorted(classes3d.rglob('*.class')):z.write(p,p.relative_to(classes3d).as_posix())
(output/'ogl.jam').write_text('AppName=Original 3D Test Fixture\nAppClass=TestOgl\n',encoding='ascii')
print('Built original fixture in',output)
