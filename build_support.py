# SPDX-License-Identifier: GPL-3.0-or-later
from pathlib import Path
import os, re, shutil, subprocess, zipfile
from notices import verify as verify_notices
ROOT=Path(__file__).resolve().parent

def find_javac():
    """Fail before changing build output; JAVA_HOME also works without PATH edits."""
    java_home=os.environ.get('JAVA_HOME')
    compiler=(str(Path(java_home)/'bin'/('javac.exe' if os.name=='nt' else 'javac'))
              if java_home else shutil.which('javac'))
    help_text=('JDK 17+ is required to build (a JRE alone is insufficient).\n'
               'Install a JDK, reopen PowerShell, and check: javac -version\n'
               'Or set JAVA_HOME to the JDK directory. See README.md.\n'
               'The existing JAR was NOT updated; git pull / serve.py do not compile Java.')
    if not compiler or not Path(compiler).is_file():
        raise SystemExit('Cannot find javac'+(' in JAVA_HOME.' if java_home else ' on PATH.')+'\n'+help_text)
    try:
        result=subprocess.run([compiler,'-version'],capture_output=True,text=True,timeout=15)
    except (OSError,subprocess.TimeoutExpired) as error:
        raise SystemExit('Cannot run javac: '+str(error)+'\n'+help_text) from None
    version=(result.stdout+result.stderr).strip()
    match=re.search(r'\bjavac\s+(?:1\.)?(\d+)',version)
    if result.returncode or not match or int(match[1])<17:
        raise SystemExit('Unsupported compiler: '+version+'\n'+help_text)
    print('Compiler:',compiler,'('+version+')')
    return compiler

def clean_classes(path):
    """Only remove one of our two dedicated class-output directories."""
    resolved=path.resolve()
    allowed={(ROOT/'build/classes').resolve(),(ROOT/'build/ogl-classes').resolve()}
    if resolved not in allowed or not resolved.is_relative_to(ROOT.resolve()):
        raise ValueError('Refusing to clean outside the class-output directories')
    if path.exists(): shutil.rmtree(path)
    path.mkdir(parents=True)

def add_file(archive,path,name):
    add_bytes(archive,path.read_bytes(),name)

def add_bytes(archive,data,name):
    info=zipfile.ZipInfo(name,(2026,1,1,0,0,0))
    info.compress_type=zipfile.ZIP_DEFLATED
    info.external_attr=0o644<<16
    archive.writestr(info,data)

def add_notices(archive):
    verify_notices()
    for name in ['LICENSE','THIRD_PARTY.md','NOTICE.txt']:
        add_file(archive,ROOT/name,'META-INF/'+name)
    for path in sorted((ROOT/'licenses').glob('*.txt')):
        add_file(archive,path,'META-INF/licenses/'+path.name)

MODIFIED='// Modified by i-app-emulator-in-browser; last changed 2026-09-24. See build scripts and THIRD_PARTY.md.\n'
