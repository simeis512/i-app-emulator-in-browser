from pathlib import Path
import os, subprocess
ROOT=Path(__file__).resolve().parent
out=ROOT/'test-results/unit';out.mkdir(parents=True,exist_ok=True)
classes=ROOT/'build/test-classes';classes.mkdir(parents=True,exist_ok=True)
jar=ROOT/'web/p905i-runtime.jar'
ogl=ROOT/'web/p905i-ogl.jar'

def run_checks(name,release,classpath,log,marker,args=()):
    classpath=os.pathsep.join(map(str,classpath))
    subprocess.run(['javac','-J-Duser.language=en','--release',str(release),'-encoding','UTF-8','-cp',classpath,'-d',str(classes),str(ROOT/'tests'/(name+'.java'))],check=True)
    result=subprocess.run(['java','-Djava.awt.headless=true','-Dfile.encoding=Shift_JIS','-cp',os.pathsep.join([str(classes),classpath]),name,*args],capture_output=True,timeout=20)
    text=(result.stdout+result.stderr).decode('utf-8',errors='replace')
    (out/log).write_text(text,encoding='utf-8');print(text)
    if result.returncode:raise SystemExit(result.returncode)
    assert marker in text, name+' exited before completion'

run_checks('RuntimeChecks',8,[jar],'checks.log','ALL RUNTIME CHECKS PASSED',[str(out)])
run_checks('AudioChecks',8,[jar],'audio-checks.log','ALL AUDIO CLOCK CHECKS PASSED')
run_checks('OglChecks',17,[ogl,jar],'ogl-checks.log','ALL OGL CHECKS PASSED')
print('PASS: standalone runtime checks need no private applications or saves')
