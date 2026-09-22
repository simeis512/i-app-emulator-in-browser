# SPDX-License-Identifier: GPL-3.0-or-later
from pathlib import Path
import shutil, zipfile
from notices import verify as verify_notices
ROOT=Path(__file__).resolve().parent

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

MODIFIED='// Modified by i-app-emulator-in-browser on 2026-09-22; see build scripts and THIRD_PARTY.md.\n'
