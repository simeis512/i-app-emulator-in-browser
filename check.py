from pathlib import Path
import subprocess
ROOT=Path(__file__).resolve().parent
out=ROOT/'test-results/unit';out.mkdir(parents=True,exist_ok=True)
classes=ROOT/'build/test-classes';classes.mkdir(parents=True,exist_ok=True)
jar=ROOT/'web/p905i-runtime.jar'
subprocess.run(['javac','-J-Duser.language=en','--release','8','-encoding','UTF-8','-cp',str(jar),'-d',str(classes),str(ROOT/'tests/RuntimeChecks.java')],check=True)
import os
result=subprocess.run(['java','-Djava.awt.headless=true','-Dfile.encoding=Shift_JIS','-cp',str(classes)+os.pathsep+str(jar),'RuntimeChecks',str(out)],capture_output=True,timeout=20)
text=(result.stdout+result.stderr).decode('utf-8',errors='replace')
(out/'checks.log').write_text(text,encoding='utf-8');print(text)
if result.returncode:raise SystemExit(result.returncode)
assert 'ALL RUNTIME CHECKS PASSED' in text, 'Runtime checks exited before completion'
subprocess.run(['javac','-J-Duser.language=en','--release','8','-encoding','UTF-8','-cp',str(jar),'-d',str(classes),str(ROOT/'tests/AudioChecks.java')],check=True)
result=subprocess.run(['java','-Djava.awt.headless=true','-Dfile.encoding=Shift_JIS','-cp',str(classes)+os.pathsep+str(jar),'AudioChecks'],capture_output=True,timeout=20)
text=(result.stdout+result.stderr).decode('utf-8',errors='replace')
(out/'audio-checks.log').write_text(text,encoding='utf-8');print(text)
if result.returncode:raise SystemExit(result.returncode)
assert 'ALL AUDIO CLOCK CHECKS PASSED' in text, 'Audio checks exited before completion'
ogl=ROOT/'web/p905i-ogl.jar'
classpath=os.pathsep.join(map(str,[classes,ogl,jar]))
subprocess.run(['javac','-J-Duser.language=en','--release','17','-encoding','UTF-8','-cp',classpath,'-d',str(classes),str(ROOT/'tests/OglChecks.java')],check=True)
result=subprocess.run(['java','-Djava.awt.headless=true','-Dfile.encoding=Shift_JIS','-cp',classpath,'OglChecks'],capture_output=True,timeout=20)
text=(result.stdout+result.stderr).decode('utf-8',errors='replace')
(out/'ogl-checks.log').write_text(text,encoding='utf-8');print(text)
if result.returncode:raise SystemExit(result.returncode)
assert 'ALL OGL CHECKS PASSED' in text, 'OGL checks exited before completion'
print('PASS: standalone runtime checks need no private applications or saves')
