# SPDX-License-Identifier: GPL-3.0-or-later
from pathlib import Path
import subprocess, zipfile
root=Path(__file__).resolve().parents[1]
output=root/'build/fixture';classes=output/'classes';classes.mkdir(parents=True,exist_ok=True)
subprocess.run(['javac','-J-Duser.language=en','--release','8','-encoding','UTF-8','-cp',str(root/'web/p905i-runtime.jar'),'-d',str(classes),str(root/'tests/TestIappli.java')],check=True)
with zipfile.ZipFile(output/'fixture.jar','w',zipfile.ZIP_DEFLATED) as z:
    for p in sorted(classes.rglob('*.class')):z.write(p,p.relative_to(classes).as_posix())
(output/'fixture.jam').write_text('AppName=Original Test Fixture\nAppClass=TestIappli\nSPsize=16\n',encoding='ascii')
(output/'fixture.sp').write_bytes((16).to_bytes(4,'big')+bytes(12))
print('Built original fixture in',output)
