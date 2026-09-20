"""Optional Java 17 software OpenGL ES adapter from openDoJa (GPL-3.0).

Native JOGL is deliberately excluded: the selected renderer draws into the same
BufferedImage as FreeJ2ME's 2D graphics. Original upstream sources stay intact.
"""
from pathlib import Path
import re, subprocess, zipfile
from dependencies import verify
from build_support import clean_classes, add_file, add_notices, MODIFIED
ROOT=Path(__file__).resolve().parent
UP=ROOT/'vendor/openDoJa-master/src/main/java'
OUT=ROOT/'build/ogl-src'
CLASSES=ROOT/'build/ogl-classes'

def write(rel,text):
    dst=OUT/rel;dst.parent.mkdir(parents=True,exist_ok=True)
    dst.write_text(MODIFIED+text,encoding='utf-8');return dst

def build():
    verify('opendoja')
    sources=[]
    for p in (UP/'com/nttdocomo/ui/ogl').rglob('*.java'):
        if p.name=='package-info.java':continue
        text=p.read_text(encoding='utf-8')
        if p.name=='GraphicsOGL.java':
            # Unsupported entry points must fail visibly rather than silently
            # accepting a call and drawing nothing.
            text=re.sub(r'default ([^\n{]+)\{[^{}]*\}',
                        lambda m:'default '+m[1]+'{ throw new UnsupportedOperationException("OpenGL ES: '+m[1].split('(')[0].split()[-1]+'"); }',text)
        sources.append(write(p.relative_to(UP),text))
    rel=Path('com/nttdocomo/opt/ui/ogl/GraphicsOGL2.java')
    sources.append(write(rel,(UP/rel).read_text(encoding='utf-8')))
    names=['HostDirectBuffers','OglRenderer','OglSoftwareRenderer','OglExtensionMatrixMode','AcrodeaOglMatrixExtension','AcrodeaOglRenderer']
    for name in names:
        rel=Path('opendoja/host/ogl')/(name+'.java')
        text=(UP/rel).read_text(encoding='utf-8')
        if name=='OglRenderer':
            text=text.replace('import opendoja.host.OpenDoJaLaunchArgs;','').replace('import opendoja.host.OpenGlesRendererMode;','')
            text=re.sub(r'    private final OglHardwareBackend hardware = .*?;','',text)
            text=text.replace('return OpenDoJaLaunchArgs.openGlesRendererMode() == OpenGlesRendererMode.HARDWARE;','return false;')
            text=text.replace('return hardware.hasBufferedHardwarePresentation();','return false;')
            text=text.replace('usesHardwareRenderer() && hardware.clear(mask)','false')
            text=text.replace('usesHardwareRenderer() && hardware.draw(mode, first, count, indexSource)','false')
            text=re.sub(r'\bhardware\.\w+\([^;\n]*\);','/* Native backend excluded; using software renderer. */',text)
            assert 'hardware.' not in text
            text=text.replace('public class OglRenderer {', '''public class OglRenderer {
    private final p905i.web.FogState fog = new p905i.web.FogState();
    public final void glFogf(int pname, float param) { fog.parameter(pname,param); }
    public final void glFogfv(int pname, float[] params) { fog.parameter(pname,params); }
''')
            text=text.replace('public final void glEnable(int cap) {','public final void glEnable(int cap) {\n    if(cap==GraphicsOGL.GL_FOG) { fog.enabled=true; return; }')
            text=text.replace('public final void glDisable(int cap) {','public final void glDisable(int cap) {\n    if(cap==GraphicsOGL.GL_FOG) { fog.enabled=false; return; }')
            old='int fragmentColor = applyTextureEnvironment(primaryColor, sampled, texture);'
            assert text.count(old)==1
            text=text.replace(old,old+'\n            fragmentColor = fog.apply(fragmentColor, 1f / denominator);')
            renderer=text
        sources.append(write(rel,text))
    rel=Path('opendoja/host/DesktopSurface.java')
    text=(UP/rel).read_text(encoding='utf-8')
    text=text.replace('public DesktopSurface(int width, int height) {',
                      'public DesktopSurface(BufferedImage image) { this.image = image; }\n    public DesktopSurface(int width, int height) {')
    sources.append(write(rel,text))
    methods=re.findall(r'public (?:final )?(\w+(?:\[\])?) ((?:gl\w+|beginDrawing|endDrawing))\(([^)]*)\)\s*\{',renderer)
    adapter='''package com.nttdocomo.ui;
import com.nttdocomo.ui.ogl.*;
import com.nttdocomo.opt.ui.ogl.GraphicsOGL2;
import org.recompile.mobile.*;
import opendoja.host.DesktopSurface;
import opendoja.host.ogl.*;
/** Browser software OpenGL bridge. GPL-3.0-or-later. */
public class Graphics extends PlatformGraphics implements GraphicsOGL2 {
    private final OglRenderer ogl;
    private int activeTexture = GL_TEXTURE0, clientTexture = GL_TEXTURE0;
    private boolean warnedReflection;
    private int writeMask = -1;
    public void glColorMask(boolean red, boolean green, boolean blue, boolean alpha) {
        writeMask=(red?0x00ff0000:0)|(green?0x0000ff00:0)|(blue?0x000000ff:0)|(alpha?0xff000000:0);
    }
    private int[] beforeMaskedDraw() { return writeMask == -1 ? null : canvasData.clone(); }
    private void afterMaskedDraw(int[] before) {
        if(before!=null) for(int i=0;i<canvasData.length;i++) canvasData[i]=(canvasData[i]&writeMask)|(before[i]&~writeMask);
    }
    private void reflectionNotice() {
        if(!warnedReflection) { warnedReflection=true; p905i.web.BrowserRuntime.recordLog("3D limitation: secondary texture/cube reflection is not rendered."); }
    }
    public void glActiveTexture(int texture) {
        if(texture != GL_TEXTURE0 && texture != GL_TEXTURE0+1) throw new IllegalArgumentException("texture unit");
        activeTexture=texture;
    }
    public void glTexEnvf(int target, int pname, float param) {
        if(activeTexture!=GL_TEXTURE0) { reflectionNotice(); return; }
        ogl.glTexEnvi(target,pname,Math.round(param));
    }
    public Graphics(final PlatformImage image) {
        super(image);
        final DesktopSurface surface = new DesktopSurface(image.getCanvas());
        ogl = new AcrodeaOglRenderer(new OglRenderer.Host() {
            public DesktopSurface surface() { return surface; }
            public java.awt.Graphics2D delegate() { return gc; }
            public void markOpenGlesActivity() { surface.markOpenGlesActivity(); }
            // DoJa presents the completed canvas at Graphics.unlock(). A clear
            // must not expose an intermediate frame or bypass glColorMask.
            public void flushSurfacePresentation() { }
            public void onSoftwareSurfaceMutation() { }
        });
    }
'''
    for result,name,params in methods:
        args=', '.join(p.strip().split()[-1] for p in params.split(',') if p.strip())
        guard=''
        if name=='glClientActiveTexture': guard='clientTexture=texture; '
        if name in ['glEnable','glDisable']: guard='if(activeTexture!=GL_TEXTURE0 && (cap==GL_TEXTURE_2D || cap==GL_TEXTURE_CUBE_MAP || cap==GL_TEXTURE_GEN_STR)) { reflectionNotice(); return; } '
        if name in ['glEnableClientState','glDisableClientState']:guard='if(clientTexture!=GL_TEXTURE0 && array==GL_TEXTURE_COORD_ARRAY) return; '
        if name=='glTexCoordPointer':guard='if(clientTexture!=GL_TEXTURE0) return; '
        if name in ['glBindTexture','glCompressedTexImage2D','glTexImage2D','glTexParameterf','glTexParameteri','glTexEnvf','glTexEnvi','glTexEnvfv']:
            guard='if(activeTexture!=GL_TEXTURE0) { reflectionNotice(); return; } '
        call=('return ' if result!='void' else '')+f'ogl.{name}({args});'
        if name in ['glClear','glDrawArrays','glDrawElements']:
            call='int[] before=beforeMaskedDraw(); try { '+call+' } finally { afterMaskedDraw(before); }'
        adapter+=f'    public {result} {name}({params}) {{ '+guard+call+' }\n'
    interface2=(UP/'com/nttdocomo/opt/ui/ogl/GraphicsOGL2.java').read_text(encoding='utf-8')
    for result,name,params in re.findall(r'\b(void) (gl\w+)\(([^)]*)\);',interface2):
        adapter+=f'    public {result} {name}({params}) {{ if(activeTexture!=GL_TEXTURE0) {{ reflectionNotice(); return; }} throw new UnsupportedOperationException("OpenGL ES extension: {name}"); }}\n'
    adapter+='}\n'
    sources.append(write('com/nttdocomo/ui/Graphics.java',adapter))
    sources+=list((ROOT/'src-ogl').rglob('*.java'))
    sources.sort(key=lambda p:p.as_posix())
    clean_classes(CLASSES)
    argfile=ROOT/'build/ogl-sources.txt'
    argfile.write_text('\n'.join('"'+p.as_posix()+'"' for p in sources),encoding='utf-8')
    subprocess.run(['javac','-J-Duser.language=en','--release','17','-encoding','UTF-8','-cp',str(ROOT/'web/p905i-runtime.jar'),'-d',str(CLASSES),'@'+str(argfile)],check=True)
    jar=ROOT/'web/p905i-ogl.jar'
    with zipfile.ZipFile(jar,'w',zipfile.ZIP_DEFLATED) as z:
        for p in sorted(CLASSES.rglob('*.class'),key=lambda p:p.as_posix()):add_file(z,p,p.relative_to(CLASSES).as_posix())
        add_file(z,ROOT/'vendor/openDoJa-master/LICENSE','META-INF/LICENSE-openDoJa.txt')
        add_notices(z)
    print('Built optional software OpenGL adapter:',jar,jar.stat().st_size)

if __name__=='__main__':build()
