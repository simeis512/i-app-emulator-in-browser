# SPDX-License-Identifier: GPL-3.0-or-later
"""Explicit publication allowlist. Never discover distribution inputs with rglob alone."""
from pathlib import Path
import argparse, re, subprocess
from dependencies import SNAPSHOTS, verify
from notices import verify as verify_notices
ROOT=Path(__file__).resolve().parent
OWN_FILES='''
.gitattributes
.gitignore
.github/workflows/check.yml
README.md
LICENSE
THIRD_PARTY.md
NOTICE.txt
UPSTREAM.json
build.py
build_ogl.py
build_support.py
check.py
dependencies.py
notices.py
public_audit.py
package.py
package.json
package-lock.json
serve.py
Start-Emulator.cmd
Start-Emulator.ps1
Stop-Emulator.cmd
Stop-Emulator.ps1
licenses/Apache-2.0.txt
licenses/LGPL-2.0.txt
licenses/MIT-micro3d.txt
src/p905i/web/BrowserRuntime.java
src/p905i/web/ClockPlayer.java
src-ogl/p905i/web/FogState.java
tests/RuntimeChecks.java
tests/OglChecks.java
tests/TestIappli.java
tests/build_fixture.py
tests/browser.cjs
tests/loader.test.mjs
tests/test_server.py
web/index.html
web/app.js
web/loader.mjs
web/style.css
'''.split()

def source_files():
    names=list(OWN_FILES)
    for spec in SNAPSHOTS.values():
        names.extend('vendor/'+spec['directory']+'/'+name for name in spec['files'])
    if len(names)!=len(set(names)): raise ValueError('Duplicate allowlist entry')
    return sorted(names)

def audit(tracked=False):
    for name in SNAPSHOTS: verify(name)
    verify_notices()
    names=source_files()
    for name in names:
        path=ROOT/name
        if not path.is_file(): raise ValueError('Missing public source: '+name)
        if path.is_symlink() or not path.resolve().is_relative_to(ROOT):
            raise ValueError('Publication input escapes repository: '+name)
        # Reject links/junctions in ancestors too, even if they point inside the root.
        if any(parent.is_symlink() or (hasattr(parent,'is_junction') and parent.is_junction())
               for parent in path.parents if parent!=ROOT and parent.is_relative_to(ROOT)):
            raise ValueError('Linked publication input: '+name)
        if path.suffix.lower() in {'.jar','.jam','.sp','.zip','.class','.bin','.rms','.sav','.oob'}:
            raise ValueError('Application, save or build output in source list: '+name)
        if name in OWN_FILES and name not in {'NOTICE.txt','LICENSE'}:
            text=path.read_text(encoding='utf-8')
            if re.search(r'[A-Za-z]:[\\/](?:Users|p905i_dump)[\\_]|astra[_]recovery|P905i[_]recovered[_]apps',text):
                raise ValueError('Private workspace reference: '+name)
            if re.search(r'(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|-----BEGIN (?:RSA |OPENSSH )?PRIVATE KEY-----)',text):
                raise ValueError('Possible credential in public source: '+name)
    if tracked:
        data=subprocess.check_output(['git','-C',str(ROOT),'ls-files','-z'])
        registered=set(data.decode('utf-8').rstrip('\0').split('\0'))
        if registered!=set(names):
            raise ValueError('Git index differs from allowlist; extra='+str(sorted(registered-set(names)))+
                             '; missing='+str(sorted(set(names)-registered)))
        subprocess.run(['git','-C',str(ROOT),'diff','--exit-code','--quiet'],check=True)
    print('PUBLIC AUDIT PASSED:',len(names),'allowlisted source files; no application binaries or saves')
    return names

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--tracked',action='store_true')
    audit(parser.parse_args().tracked)
