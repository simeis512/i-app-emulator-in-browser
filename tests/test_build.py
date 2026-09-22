# SPDX-License-Identifier: GPL-3.0-or-later
"""Compiler preflight and copied/stale JAR regression checks with authored files."""
import json, os, shutil, subprocess, sys, tempfile, unittest, zipfile
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import build, build_support, build_state

class BuildChecks(unittest.TestCase):
    def test_missing_compiler_does_not_touch_build_output(self):
        with patch.dict(os.environ,{'JAVA_HOME':''}), patch('build_support.shutil.which',return_value=None), \
             patch('build.clean_classes') as clean:
            with self.assertRaisesRegex(SystemExit,'Cannot find javac'):
                build.build()
            clean.assert_not_called()

    def test_java_home_and_minimum_version(self):
        with tempfile.TemporaryDirectory(prefix='iapp jdk test ') as directory:
            root=Path(directory);exe=root/'bin'/('javac.exe' if os.name=='nt' else 'javac')
            exe.parent.mkdir();exe.touch()
            with patch.dict(os.environ,{'JAVA_HOME':directory}), patch('build_support.subprocess.run') as run:
                run.return_value=subprocess.CompletedProcess([],0,'','javac 17.0.1')
                self.assertEqual(build_support.find_javac(),str(exe))
                self.assertEqual(run.call_args.args[0],[str(exe),'-version'])
                for version in ['javac 1.8.0_400','javac 11.0.2','not a compiler']:
                    run.return_value=subprocess.CompletedProcess([],0,version,'')
                    with self.assertRaisesRegex(SystemExit,'Unsupported compiler'):build_support.find_javac()
                run.side_effect=FileNotFoundError('missing executable')
                with self.assertRaisesRegex(SystemExit,'Cannot run javac'):build_support.find_javac()

    def test_source_fingerprint_survives_copy_and_detects_old_build(self):
        with tempfile.TemporaryDirectory(prefix='iapp-build-test-') as directory:
            root=Path(directory)/'original';root.mkdir();(root/'web').mkdir();(root/'src').mkdir()
            for name in ['build.py','build_support.py','build_state.py','dependencies.py','notices.py',
                         'LICENSE','THIRD_PARTY.md','NOTICE.txt']:(root/name).write_text('authored fixture')
            (root/'UPSTREAM.json').write_text('{}');source=root/'src'/'Fixture.java';source.write_text('class Fixture {}')
            self.assertEqual(build_state.status(root,'runtime'),{'state':'missing'})
            jar=root/'web'/'p905i-runtime.jar'
            with zipfile.ZipFile(jar,'w') as archive:archive.writestr('fixture.txt','old unversioned jar')
            self.assertEqual(build_state.status(root,'runtime'),{'state':'unverified'})
            with zipfile.ZipFile(jar,'w') as archive:archive.writestr(build_state.RECORD,build_state.record(root,'runtime'))
            self.assertEqual(build_state.status(root,'runtime')['state'],'current')
            copied=Path(directory)/'another PC';shutil.copytree(root,copied)
            self.assertEqual(build_state.status(copied,'runtime'),build_state.status(root,'runtime'))
            source=copied/'src'/'Fixture.java';original_time=source.stat().st_mtime
            source.write_text('class Fixture { int change; }');os.utime(source,(original_time,original_time))
            self.assertEqual(build_state.status(copied,'runtime')['state'],'stale')
            (root/'src'/'New.java').write_text('class New {}')
            self.assertEqual(build_state.status(root,'runtime')['state'],'stale')
            jar.write_bytes(b'broken jar');self.assertEqual(build_state.status(root,'runtime')['state'],'unverified')

if __name__=='__main__':unittest.main()
