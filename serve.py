"""Loopback-only static server with byte ranges required by browser JVMs."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import argparse, re, shutil, json, secrets, threading
from build_state import all_status
ROOT = Path(__file__).resolve().parent/'web'

class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs): super().__init__(*args,directory=str(ROOT),**kwargs)
    def do_GET(self):
        if self.path == '/__iapp/status':
            data=json.dumps({'app':'i-app-emulator-in-browser','version':1,'builds':all_status(ROOT.parent)}).encode('ascii')
            self.send_response(200);self.send_header('Content-Type','application/json')
            self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
            return
        super().do_GET()
    def do_POST(self):
        if self.path != '/__iapp/shutdown': self.send_error(404); return
        if not secrets.compare_digest(self.headers.get('X-P905i-Token',''),self.server.shutdown_token):
            self.send_error(403); return
        self.send_response(204);self.end_headers()
        threading.Thread(target=self.server.shutdown,daemon=True).start()
    def send_head(self):
        self.byte_range = None
        path = Path(self.translate_path(self.path)).resolve()
        if not path.is_relative_to(ROOT.resolve()):
            self.send_error(403); return None
        if path.is_file() and 'Range' in self.headers:
            size = path.stat().st_size
            match = re.fullmatch(r'bytes=(\d*)-(\d*)',self.headers['Range'])
            if not match or not any(match.groups()): self.send_error(416); return None
            a,b=match.groups()
            start = int(a) if a else max(0,size-int(b))
            end = min(int(b),size-1) if a and b else size-1
            if start>end or start>=size:
                self.send_response(416);self.send_header('Content-Range',f'bytes */{size}');self.end_headers();return None
            stream=path.open('rb');stream.seek(start)
            self.send_response(206)
            self.send_header('Content-Type',self.guess_type(str(path)))
            self.send_header('Content-Range',f'bytes {start}-{end}/{size}')
            self.send_header('Content-Length',str(end-start+1))
            self.end_headers();self.byte_range=end-start+1
            return stream
        return super().send_head()
    def copyfile(self,source,outputfile):
        if self.byte_range is None: return shutil.copyfileobj(source,outputfile)
        remaining=self.byte_range
        while remaining:
            data=source.read(min(65536,remaining))
            if not data: break
            outputfile.write(data);remaining-=len(data)
    def end_headers(self):
        self.send_header('Accept-Ranges','bytes')
        self.send_header('Cache-Control','no-cache')
        self.send_header('X-Content-Type-Options','nosniff')
        super().end_headers()

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--port',type=int,default=9052)
    args=parser.parse_args()
    for component,info in all_status(ROOT.parent).items():
        print(component+' build: '+info['state']+' '+info.get('id',''),flush=True)
        if info['state']!='current':
            print('Rebuild before using this component: python build.py, then python build_ogl.py',flush=True)
    print(f'i-appli emulator: http://127.0.0.1:{args.port}/ (Ctrl+C to stop)',flush=True)
    with ThreadingHTTPServer(('127.0.0.1',args.port),Handler) as server:
        server.shutdown_token=secrets.token_hex(32)
        runtime=ROOT.parent/'.runtime';runtime.mkdir(exist_ok=True)
        (runtime/f'server-{args.port}.token').write_text(server.shutdown_token,encoding='ascii')
        server.serve_forever()
