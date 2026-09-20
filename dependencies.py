# SPDX-License-Identifier: GPL-3.0-or-later
"""Verify vendored build inputs against the recorded upstream snapshot."""
from pathlib import Path
import hashlib, json

ROOT=Path(__file__).resolve().parent
SNAPSHOTS=json.loads((ROOT/'UPSTREAM.json').read_text(encoding='utf-8'))

def verify(name):
    spec=SNAPSHOTS[name]
    base=ROOT/'vendor'/spec['directory']
    actual={p.relative_to(base).as_posix() for p in base.rglob('*') if p.is_file()}
    if actual!=set(spec['files']):
        raise ValueError('Unexpected/missing upstream files: '+name)
    for rel,digest in spec['files'].items():
        if hashlib.sha256((base/rel).read_bytes()).hexdigest()!=digest:
            raise ValueError('Modified upstream input: '+name+'/'+rel)
    print('Verified',name,len(actual),'upstream files')

if __name__=='__main__':
    for name in SNAPSHOTS: verify(name)
