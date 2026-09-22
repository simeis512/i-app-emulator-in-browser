# SPDX-License-Identifier: GPL-3.0-or-later
"""Real HTTP tests with temporary synthetic data; no installed games required."""
import http.client, importlib.util, json, sys, tempfile, threading, unittest
from pathlib import Path
from http.server import ThreadingHTTPServer
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))

spec=importlib.util.spec_from_file_location('emulator_server',Path(__file__).resolve().parents[1]/'serve.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class ServerChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory(prefix='iapp-server-test-')
        base=Path(cls.temp.name);module.ROOT=base/'web';module.ROOT.mkdir()
        (module.ROOT/'index.html').write_bytes(b'<html>original fixture</html>')
        (module.ROOT/'range.dat').write_bytes(bytes(range(256)))
        (base/'outside.txt').write_bytes(b'must not be served')
        cls.server=ThreadingHTTPServer(('127.0.0.1',0),module.Handler)
        cls.server.shutdown_token='synthetic-test-token'
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True);cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown();cls.server.server_close();cls.thread.join(5);cls.temp.cleanup()

    def request(self,path='/range.dat',method='GET',headers=None):
        connection=http.client.HTTPConnection('127.0.0.1',self.server.server_port,timeout=3)
        try:
            connection.request(method,path,headers=headers or {})
            response=connection.getresponse();body=response.read()
            return response.status,dict(response.getheaders()),body
        finally: connection.close()

    def test_identity_and_full_file(self):
        status,headers,body=self.request('/__iapp/status')
        self.assertEqual(status,200);self.assertEqual(json.loads(body)['app'],'i-app-emulator-in-browser')
        self.assertEqual(json.loads(body)['builds']['runtime']['state'],'missing')
        status,headers,body=self.request();self.assertEqual(body,bytes(range(256)))
        self.assertEqual(headers['Accept-Ranges'],'bytes')

    def test_byte_ranges(self):
        for header,start,end in [('bytes=4-8',4,8),('bytes=250-',250,255),('bytes=-3',253,255),('bytes=252-999',252,255)]:
            with self.subTest(header=header):
                status,headers,body=self.request(headers={'Range':header})
                self.assertEqual(status,206);self.assertEqual(body,bytes(range(start,end+1)))
                self.assertEqual(headers['Content-Range'],f'bytes {start}-{end}/256')
                self.assertEqual(int(headers['Content-Length']),end-start+1)

    def test_head_and_invalid_ranges(self):
        status,headers,body=self.request(method='HEAD',headers={'Range':'bytes=4-8'})
        self.assertEqual(status,206);self.assertEqual(body,b'');self.assertEqual(headers['Content-Length'],'5')
        for header in ['bytes=256-','bytes=8-4','bytes=-0','bytes=-','bytes=0-1,3-4','items=1-2']:
            with self.subTest(header=header): self.assertEqual(self.request(headers={'Range':header})[0],416)

    def test_no_parent_files_or_uploads(self):
        for path in ['/outside.txt','/../outside.txt','/%2e%2e/outside.txt']:
            with self.subTest(path=path): self.assertEqual(self.request(path)[0],404)
        self.assertEqual(self.request('/upload',method='POST')[0],404)
        self.assertEqual(self.request('/__iapp/shutdown',method='POST')[0],403)

    def test_z_authenticated_shutdown(self):
        self.assertEqual(self.request('/__iapp/shutdown',method='POST',headers={'X-P905i-Token':'synthetic-test-token'})[0],204)
        self.thread.join(5);self.assertFalse(self.thread.is_alive())

if __name__=='__main__': unittest.main()
