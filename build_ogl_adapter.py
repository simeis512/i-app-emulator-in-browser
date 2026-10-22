# SPDX-License-Identifier: GPL-3.0-or-later
"""Generated parts of the com.nttdocomo.ui.Graphics adapter that build_ogl.py writes."""
import re

# With the GPU renderer, the CPU picture can lag behind GPU drawing that is not read back yet. Every 2D call on the
# adapter first lets that drawing come back (and a write marks the picture changed); images drawn from are synchronised
# as sources the same way. (name, parameters, call arguments, source image expression or None, writes)
CPU_ACCESS=[
    ('drawImage','com.nttdocomo.ui.Image image, int x, int y','image, x, y','image',True),
    ('drawImage','com.nttdocomo.ui.Image image, int dx, int dy, int sx, int sy, int width, int height','image, dx, dy, sx, sy, width, height','image',True),
    ('drawImage','com.nttdocomo.ui.Image image, int[] matrix','image, matrix','image',True),
    ('drawImage','com.nttdocomo.ui.Image image, int[] matrix, int sx, int sy, int width, int height','image, matrix, sx, sy, width, height','image',True),
    ('drawScaledImage','com.nttdocomo.ui.Image image, int dx, int dy, int width, int height, int sx, int sy, int swidth, int sheight','image, dx, dy, width, height, sx, sy, swidth, sheight','image',True),
    ('drawString','String str, int x, int y','str, x, y',None,True),
    ('drawChars','char[] data, int x, int y, int offset, int length','data, x, y, offset, length',None,True),
    ('fillRect','int x, int y, int width, int height','x, y, width, height',None,True),
    ('drawRect','int x, int y, int width, int height','x, y, width, height',None,True),
    ('clearRect','int x, int y, int width, int height','x, y, width, height',None,True),
    ('drawLine','int x1, int y1, int x2, int y2','x1, y1, x2, y2',None,True),
    ('fillPolygon','int[] xPoints, int[] yPoints, int numPoints','xPoints, yPoints, numPoints',None,True),
    ('fillPolygon','int[] xPoints, int[] yPoints, int offset, int numPoints','xPoints, yPoints, offset, numPoints',None,True),
    ('drawPolyline','int[] xPoints, int[] yPoints, int nPoints','xPoints, yPoints, nPoints',None,True),
    ('drawPolyline','int[] xPoints, int[] yPoints, int offset, int count','xPoints, yPoints, offset, count',None,True),
    ('fillArc','int x, int y, int width, int height, int startAngle, int arcAngle','x, y, width, height, startAngle, arcAngle',None,True),
    ('drawArc','int x, int y, int width, int height, int startAngle, int arcAngle','x, y, width, height, startAngle, arcAngle',None,True),
    ('drawSpriteSet','com.nttdocomo.ui.SpriteSet sprites','sprites',None,True),
    ('drawImageMap','com.nttdocomo.ui.ImageMap map, int x, int y','map, x, y',None,True),
    ('setPixel','int x, int y','x, y',None,True),
    ('setPixel','int x, int y, int color','x, y, color',None,True),
    ('setPixels','int x, int y, int width, int height, int[] array, int offset','x, y, width, height, array, offset',None,True),
    ('copyArea','int x, int y, int width, int height, int dx, int dy','x, y, width, height, dx, dy',None,True),
    ('unlock','boolean forced','forced',None,False),
]
CPU_READS=[
    ('int','getPixel','int x, int y','x, y'),
    ('int','getRGBPixel','int x, int y','x, y'),
    ('int[]','getPixels','int x, int y, int width, int height, int[] array, int offset','x, y, width, height, array, offset'),
    ('int[]','getRGBPixels','int x, int y, int width, int height, int[] array, int offset','x, y, width, height, array, offset'),
]
CPU_SYNC=''.join(
    f'    public void {name}({params}) {{ '
    +(f'if({source}!=null) OglRenderer.gpuCpuAccess({source}.getCanvas(), false); ' if source else '')
    +f'OglRenderer.gpuCpuAccess(picture, {str(writes).lower()}); super.{name}({args}); }}\n'
    for name,params,args,source,writes in CPU_ACCESS)+''.join(
    f'    public {result} {name}({params}) {{ OglRenderer.gpuCpuAccess(picture, false); return super.{name}({args}); }}\n'
    for result,name,params,args in CPU_READS)

def call_args(params):
    return ', '.join(p.strip().split()[-1] for p in params.split(',') if p.strip())

def adapter_source(renderer,interface2):
    """The Graphics adapter: every GL entry point of the renderer, with texture unit 1 routed to the GPU."""
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
    private final java.awt.image.BufferedImage picture;
    private final opendoja.host.ogl.ReflectionUnit unit1;
    public void glColorMask(boolean red, boolean green, boolean blue, boolean alpha) {
        writeMask=(red?0x00ff0000:0)|(green?0x0000ff00:0)|(blue?0x000000ff:0)|(alpha?0xff000000:0);
        ogl.gpuColorMask(red,green,blue,alpha);
    }
    // The GPU renderer masks its own draws; a colour clear is still filled on the CPU, once the GPU picture is back.
    private int[] beforeMaskedDraw(boolean clear) {
        if(writeMask == -1) return null;
        if(ogl.gpuActive()) { if(!clear) return null; ogl.gpuFlush(); }
        return canvasData.clone();
    }
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
        if(activeTexture!=GL_TEXTURE0) { if(unit1!=null) unit1.glTexEnvf(target,pname,param); else reflectionNotice(); return; }
        ogl.glTexEnvi(target,pname,Math.round(param));
    }
    public Graphics(final PlatformImage image) {
        super(image);
        picture = image.getCanvas();
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
        unit1 = ogl.gpuReflectionUnit();
    }
'''
    adapter=adapter.replace('    private void reflectionNotice() {',CPU_SYNC+'    private void reflectionNotice() {')
    for result,name,params in methods:
        args=call_args(params)
        guard=''
        if name=='glClientActiveTexture': guard='clientTexture=texture; '
        if name in ['glEnable','glDisable']: guard=f'if(activeTexture!=GL_TEXTURE0 && (cap==GL_TEXTURE_2D || cap==GL_TEXTURE_CUBE_MAP || cap==GL_TEXTURE_GEN_STR)) {{ if(unit1!=null) unit1.{name}(cap); else reflectionNotice(); return; }} '
        if name in ['glEnableClientState','glDisableClientState']:guard='if(clientTexture!=GL_TEXTURE0 && array==GL_TEXTURE_COORD_ARRAY) return; '
        if name=='glTexCoordPointer':guard='if(clientTexture!=GL_TEXTURE0) return; '
        if name in ['glBindTexture','glCompressedTexImage2D','glTexImage2D','glTexParameterf','glTexParameteri','glTexEnvf','glTexEnvi','glTexEnvfv']:
            guard=f'if(activeTexture!=GL_TEXTURE0) {{ if(unit1!=null) unit1.{name}({args}); else reflectionNotice(); return; }} '
        call=('return ' if result!='void' else '')+f'ogl.{name}({args});'
        if name=='glDeleteTextures': call+=' if(unit1!=null) unit1.deleteTextures('+('n' if 'int n' in params else 'textures.length')+', textures);'
        if name in ['glClear','glDrawArrays','glDrawElements']:
            call=f'int[] before=beforeMaskedDraw({str(name=="glClear").lower()}); try {{ '+call+' } finally { afterMaskedDraw(before); }'
        adapter+=f'    public {result} {name}({params}) {{ '+guard+call+' }\n'
    for result,name,params in re.findall(r'\b(void) (gl\w+)\(([^)]*)\);',interface2):
        args=call_args(params)
        adapter+=(f'    public {result} {name}({params}) {{ if(activeTexture!=GL_TEXTURE0) {{ if(unit1!=null) {{ unit1.{name}({args}); return; }} '
                  f'reflectionNotice(); return; }} throw new UnsupportedOperationException("OpenGL ES extension: {name}"); }}\n')
    adapter+='}\n'
    return adapter
