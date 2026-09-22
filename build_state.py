# SPDX-License-Identifier: GPL-3.0-or-later
"""Portable source fingerprints embedded in JARs, never based on copy timestamps."""
from pathlib import Path
import hashlib, json, zipfile

RECORD='META-INF/iapp-build.json'
JARS={'runtime':'p905i-runtime.jar','ogl':'p905i-ogl.jar'}

def fingerprint(root,component):
    root=Path(root)
    names=['build.py','build_support.py','build_state.py','dependencies.py','notices.py',
           'UPSTREAM.json','LICENSE','THIRD_PARTY.md','NOTICE.txt']
    names.extend(p.relative_to(root).as_posix() for p in (root/'src').rglob('*.java'))
    if component=='ogl':
        names.append('build_ogl.py')
        names.extend(p.relative_to(root).as_posix() for p in (root/'src-ogl').rglob('*.java'))
    for p in (root/'licenses').glob('*.txt'):names.append(p.relative_to(root).as_posix())
    # Read the explicit upstream manifest, not arbitrary files in the workspace.
    for spec in json.loads((root/'UPSTREAM.json').read_text(encoding='utf-8')).values():
        names.extend('vendor/'+spec['directory']+'/'+name for name in spec['files'])
    digest=hashlib.sha256()
    for name in sorted(set(names)):
        digest.update(name.encode('utf-8')+b'\0')
        digest.update(hashlib.sha256((root/name).read_bytes()).digest())
    return digest.hexdigest()

def record(root,component):
    return json.dumps({'version':1,'component':component,'source_sha256':fingerprint(root,component)},
                      sort_keys=True).encode('ascii')

def status(root,component):
    jar=Path(root)/'web'/JARS[component]
    if not jar.is_file():return {'state':'missing'}
    try:
        with zipfile.ZipFile(jar) as archive:info=json.loads(archive.read(RECORD))
        digest=info['source_sha256']
        if info.get('version')!=1 or info.get('component')!=component or not isinstance(digest,str):
            return {'state':'unverified'}
        expected=fingerprint(root,component)
        return {'state':'current' if digest==expected else 'stale','id':digest[:12]}
    except (OSError,KeyError,ValueError,TypeError,zipfile.BadZipFile):
        return {'state':'unverified'}

def all_status(root):return {name:status(root,name) for name in JARS}
