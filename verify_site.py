# SPDX-License-Identifier: GPL-3.0-or-later
"""Check a published site for the byte ranges CheerpJ needs and the corresponding source."""
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
import argparse, hashlib, io, json, time, zipfile

# Bot protection in front of a published site rejects the default urllib agent.
AGENT={'User-Agent':'i-app-emulator-in-browser verify_site.py'}

def fetch(url,headers=None,limit=8*1024*1024):
    try:
        with urlopen(Request(url,headers={**AGENT,**(headers or {})}),timeout=60) as response:
            return response.status,response.headers,response.read(limit)
    except HTTPError as error:
        with error: return error.status,error.headers,b''
    except (URLError,OSError) as error:
        return 0,{},str(error).encode()

def run(base,sums):
    failures=[]
    def check(ok,message):
        print(('PASS ' if ok else 'FAIL ')+message)
        if not ok: failures.append(message)
    status,headers,body=fetch(base)
    check(status==200,'index.html is served')
    html=body.decode('utf-8','replace')
    check('source.zip' in html,'index.html offers the corresponding source')
    check('cjrtnc.leaningtech.com' in html,'the Java runtime is loaded from the CheerpJ CDN')
    for name in ['p905i-runtime.jar','p905i-ogl.jar']:
        # CheerpJ reads JARs in chunks, and a host that compresses them drops ranges.
        status,headers,body=fetch(base+name,{'Range':'bytes=0-255'})
        check(status==206 and len(body)==256,name+' answers a byte range with 206')
        check(status==206 and not headers.get('Content-Encoding'),name+' is served uncompressed')
        check(body[:2]==b'PK',name+' starts with a ZIP signature')
    status,headers,body=fetch(base+'source.zip',limit=64*1024*1024)
    check(status==200,'source.zip is downloadable')
    if status==200:
        try:
            names=zipfile.ZipFile(io.BytesIO(body)).namelist()
            check({'build.py','LICENSE','THIRD_PARTY.md'}<=set(names),'source.zip carries the build scripts and licences')
        except zipfile.BadZipFile: check(False,'source.zip is a readable archive')
    for name,digest in (sums or {}).items():
        # Prove the live site is this build, not a stale deployment.
        target=base+name.split('/',1)[1]
        status,headers,body=fetch(target,limit=64*1024*1024)
        check(status==200 and hashlib.sha256(body).hexdigest()==digest,name.split('/',1)[1]+' matches the built checksum')
    return failures

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('url');parser.add_argument('--sums');parser.add_argument('--wait',type=int,default=0)
    args=parser.parse_args()
    base=args.url.rstrip('/')+'/'
    sums=json.loads(open(args.sums,encoding='utf-8').read()) if args.sums else None
    if sums: sums={name:digest for name,digest in sums.items() if name.startswith('web/')}
    deadline=time.time()+args.wait
    while True:
        failures=run(base,sums)
        if not failures or time.time()>=deadline: break
        print('Retrying in 15s while the deployment propagates',flush=True);time.sleep(15)
    if failures: raise SystemExit(str(len(failures))+' check(s) failed for '+base)
    print('SITE VERIFIED:',base)
