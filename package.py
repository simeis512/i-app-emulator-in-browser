# SPDX-License-Identifier: GPL-3.0-or-later
"""Build a source-complete distribution from explicit, audited inputs."""
from pathlib import Path
import hashlib, io, json, zipfile
from public_audit import audit
from build_support import add_file, add_bytes
import build, build_ogl
ROOT=Path(__file__).resolve().parent

def package():
    names=audit()
    # Always compile from the source being packaged, never reuse arbitrary JARs.
    build.build();build_ogl.build()
    source=io.BytesIO()
    with zipfile.ZipFile(source,'w') as archive:
        for name in names: add_file(archive,ROOT/name,name)
    source_bytes=source.getvalue()
    destination=ROOT/'dist';destination.mkdir(exist_ok=True)
    output=destination/'i-app-emulator-in-browser.zip'
    jars=['web/p905i-runtime.jar','web/p905i-ogl.jar']
    hashes={name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in jars}
    hashes['web/source.zip']=hashlib.sha256(source_bytes).hexdigest()
    with zipfile.ZipFile(output,'w') as archive:
        for name in names:
            if name=='web/index.html':
                html=(ROOT/name).read_text(encoding='utf-8')
                marker='<a href="https://github.com/simeis512/i-app-emulator-in-browser">ソース・説明書・ライセンス</a>'
                assert html.count(marker)==1
                html=html.replace(marker,'<a href="source.zip">この配布版のソース・説明書・ライセンス</a> · '+marker)
                add_bytes(archive,html.encode('utf-8'),name)
            else: add_file(archive,ROOT/name,name)
        for name in jars: add_file(archive,ROOT/name,name)
        add_bytes(archive,source_bytes,'web/source.zip')
        add_bytes(archive,(json.dumps(hashes,indent=2)+'\n').encode('utf-8'),'SHA256SUMS.json')
    with zipfile.ZipFile(output) as archive:
        assert set(archive.namelist())==set(names+jars+['web/source.zip','SHA256SUMS.json'])
        assert archive.testzip() is None
    print('PACKAGED',output,output.stat().st_size,'bytes (emulator, corresponding sources and licenses)')

if __name__=='__main__': package()
