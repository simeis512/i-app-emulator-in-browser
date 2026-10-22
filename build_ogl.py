"""Optional Java 17 software OpenGL ES adapter from openDoJa (GPL-3.0).

Native JOGL is deliberately excluded: the selected renderer draws into the same
BufferedImage as FreeJ2ME's 2D graphics. Original upstream sources stay intact.
"""
from pathlib import Path
import hashlib, re, zipfile
from dependencies import verify
from build_support import clean_classes, add_file, add_bytes, add_notices, find_javac, write_modified, compile_java
from build_state import RECORD, record, status
from build_ogl_raster import RASTER_LOOP
from build_ogl_adapter import adapter_source
ROOT=Path(__file__).resolve().parent
UP=ROOT/'vendor/openDoJa-master/src/main/java'
OUT=ROOT/'build/ogl-src'
CLASSES=ROOT/'build/ogl-classes'

def write(rel,text):return write_modified(OUT/rel,text)

def build():
    compiler=find_javac()
    if status(ROOT,'runtime')['state']!='current':
        raise SystemExit('Build the current core runtime first: python build.py')
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
            # Per-pixel rounding and texture wrapping: Math.round/Math.floor dominated textured drawing under CheerpJ.
            # ExactMath returns the same values for every input, so only the cost changes.
            old='float wrapped = value - (float) Math.floor(value);'
            assert text.count(old)==1
            text=text.replace(old,'float wrapped = p905i.web.ExactMath.fraction(value);')
            for old in ['clamp(Math.round(sampledU * (width - 1)), 0, width - 1)','clamp(Math.round(sampledV * (height - 1)), 0, height - 1)',
                        'clamp(Math.round((x - x0) * 256f), 0, 256)','clamp(Math.round((y - y0) * 256f), 0, 256)',
                        'clamp(Math.round(alpha), 0, 255)','clamp(Math.round(red), 0, 255)',
                        'clamp(Math.round(green), 0, 255)','clamp(Math.round(blue), 0, 255)']:
                assert text.count(old)==1,old
                text=text.replace(old,old.replace('Math.round(','p905i.web.ExactMath.round('))
            start=text.index('    boolean texturing = ogl.textureEnabled();\n    OglTexture texture = texturing ? ogl.boundTexture() : null;')
            end=text.index('\nvoid drawLineLoop(')
            assert hashlib.sha256(text[start:end].encode('utf-8')).hexdigest()[:16]=='30b72db99885a01f','pixel loop changed upstream'
            text=text[:start]+RASTER_LOOP+text[end:]
            # Triangle setup. A triangle inside all six clip planes leaves clipping as three copies of itself, so it is
            # projected directly; its bounding box is rounded without Math.floor/Math.ceil.
            for old,new in [
                ('    RasterVertex[] input = clipInput;\n    RasterVertex[] scratch = clipScratch;\n',
                 '    if (insideAllPlanes(v0) && insideAllPlanes(v1) && insideAllPlanes(v2)) {\n'
                 '        rasterizeProjectedTriangle(projectClipVertex(project0, v0), projectClipVertex(project1, v1),\n'
                 '                projectClipVertex(project2, v2), pixels, depthBuffer, clip, width, height);\n'
                 '        return;\n    }\n'
                 '    RasterVertex[] input = clipInput;\n    RasterVertex[] scratch = clipScratch;\n'),
                ('private float clipDistance(RasterVertex vertex, int plane) {',
                 'private static boolean insideAllPlanes(RasterVertex v) {\n'
                 '    return v.clipX + v.clipW >= 0f && v.clipW - v.clipX >= 0f && v.clipY + v.clipW >= 0f\n'
                 '            && v.clipW - v.clipY >= 0f && v.clipZ + v.clipW >= 0f && v.clipW - v.clipZ >= 0f;\n}\n\n'
                 'private float clipDistance(RasterVertex vertex, int plane) {'),
                ('clamp((int) Math.floor(Math.min(v0.x, Math.min(v1.x, v2.x))), 0, width - 1)',
                 'clamp(p905i.web.ExactMath.floorInt(Math.min(v0.x, Math.min(v1.x, v2.x))), 0, width - 1)'),
                ('clamp((int) Math.ceil(Math.max(v0.x, Math.max(v1.x, v2.x))), 0, width - 1)',
                 'clamp(p905i.web.ExactMath.ceilInt(Math.max(v0.x, Math.max(v1.x, v2.x))), 0, width - 1)'),
                ('clamp((int) Math.floor(Math.min(v0.y, Math.min(v1.y, v2.y))), 0, height - 1)',
                 'clamp(p905i.web.ExactMath.floorInt(Math.min(v0.y, Math.min(v1.y, v2.y))), 0, height - 1)'),
                ('clamp((int) Math.ceil(Math.max(v0.y, Math.max(v1.y, v2.y))), 0, height - 1)',
                 'clamp(p905i.web.ExactMath.ceilInt(Math.max(v0.y, Math.max(v1.y, v2.y))), 0, height - 1)'),
            ]:
                assert text.count(old)==1,old
                text=text.replace(old,new)
            # Experimental WebGL2 renderer (src-ogl GpuBackend), only when the page chose it: projected triangles are
            # recorded instead of rasterised, and the CPU picture is synchronised around each 3D section.
            for old,new in [
                ('        ogl.viewportHeight = host.surface().height();\n    }\n',
                 '        ogl.viewportHeight = host.surface().height();\n        gpu = GpuBackend.create(this);\n    }\n\n'
                 '    private final GpuBackend gpu;\n\n    p905i.web.FogState fogForGpu() {\n        return fog;\n    }\n\n'
                 '    boolean[] alphaPassForGpu() {\n        return ogl.alphaTestEnabled ? alphaPassTable() : null;\n    }\n\n'
                 '    public boolean gpuActive() {\n        return gpu != null;\n    }\n\n'
                 '    public void gpuColorMask(boolean red, boolean green, boolean blue, boolean alpha) {\n'
                 '        if (gpu != null) {\n            gpu.colorMask(red, green, blue, alpha);\n        }\n    }\n\n'
                 '    public void gpuFlush() {\n        if (gpu != null) {\n            gpu.flush();\n        }\n    }\n\n'
                 '    public static void gpuCpuAccess(java.awt.image.BufferedImage image, boolean write) {\n'
                 '        GpuBackend.cpuAccess(image, write);\n    }\n'),
                ('    host.markOpenGlesActivity();\n    ogl.beginDrawing();\n',
                 '    host.markOpenGlesActivity();\n    ogl.beginDrawing();\n    if (gpu != null) {\n        gpu.begin();\n    }\n'),
                ('    ogl.endDrawing();\n    /* Native backend excluded; using software renderer. */\n',
                 '    ogl.endDrawing();\n    if (gpu != null) {\n        gpu.end();\n    }\n'),
                ('public final void glFlush() {\n    /* Native backend excluded; using software renderer. */\n',
                 'public final void glFlush() {\n    if (gpu != null) {\n        gpu.submit();\n    }\n'),
                ('public final void glClear(int mask) {\n    host.markOpenGlesActivity();\n',
                 'public final void glClear(int mask) {\n    host.markOpenGlesActivity();\n    if (gpu != null) {\n        gpu.clear(mask);\n'
                 '        if ((mask & GraphicsOGL.GL_COLOR_BUFFER_BIT) == 0) {\n            return;\n        }\n    }\n'),
                ('    host.onSoftwareSurfaceMutation();\n    software.draw(mode, first, count, indexSource);\n',
                 '    host.onSoftwareSurfaceMutation();\n    if (gpu != null) {\n        gpu.beginDraw(host.delegate().getClipBounds());\n'
                 '        try {\n            software.draw(mode, first, count, indexSource);\n        } finally {\n            gpu.endDraw();\n        }\n'
                 '        return;\n    }\n    software.draw(mode, first, count, indexSource);\n'),
                ('    boolean useBackColor = ogl.lightModelTwoSide && !isFrontFacing(v0, v1, v2);\n',
                 '    boolean useBackColor = ogl.lightModelTwoSide && !isFrontFacing(v0, v1, v2);\n    if (gpu != null) {\n'
                 '        gpu.triangle(v0, v1, v2, useBackColor);\n        return;\n    }\n'),
                ('        ogl.textures.remove(textureId);\n',
                 '        OglTexture removed = ogl.textures.remove(textureId);\n        if (removed != null) {\n'
                 '            GpuBackend.forget(removed);\n        }\n'),
                ('    if (primitiveCount < 2) {\n        return;\n    }\n    if (!software.populateRasterVertex(firstVertex',
                 '    if (primitiveCount < 2) {\n        return;\n    }\n    if (gpu != null) {\n'
                 '        GpuBackend.notice("lines are drawn by the CPU between GPU batches");\n        gpu.cpuWrite();\n    }\n'
                 '    if (!software.populateRasterVertex(firstVertex'),
                # Texture unit 1 (a cube map reflection) is drawn by the GPU only. Its coordinates are generated per
                # vertex after lighting and travel through the vertex cache, clipping and projection with the vertex.
                ('    int color;\n    int backColor;\n\n    void set(float clipX,',
                 '    int color;\n    int backColor;\n    float reflectX;\n    float reflectY;\n    float reflectZ;\n\n    void set(float clipX,'),
                ('other.x, other.y, other.depth, other.reciprocalW, other.u, other.v, other.color, other.backColor);\n    }\n',
                 'other.x, other.y, other.depth, other.reciprocalW, other.u, other.v, other.color, other.backColor);\n'
                 '        reflectX = other.reflectX;\n        reflectY = other.reflectY;\n        reflectZ = other.reflectZ;\n    }\n'),
                ('lerpColor(from.backColor, to.backColor, t)\n        );\n    }\n',
                 'lerpColor(from.backColor, to.backColor, t)\n        );\n        reflectX = lerp(from.reflectX, to.reflectX, t);\n'
                 '        reflectY = lerp(from.reflectY, to.reflectY, t);\n        reflectZ = lerp(from.reflectZ, to.reflectZ, t);\n    }\n'),
                ('            clipVertex.backColor\n    );\n    return projected;\n',
                 '            clipVertex.backColor\n    );\n    projected.reflectX = clipVertex.reflectX;\n'
                 '    projected.reflectY = clipVertex.reflectY;\n    projected.reflectZ = clipVertex.reflectZ;\n    return projected;\n'),
                ('static RasterVertex[] createRasterVertexArray(int length) {',
                 '/** Unit 1 coordinates for the GPU: the eye direction reflected about the eye-space normal, or the normal itself.\n'
                 ' * The normal is normalised, as lighting uses it. */\n'
                 'void gpuTexGen(RasterVertex target, int vertexIndex) {\n'
                 '    if (gpu == null || !gpu.generating()) {\n        return;\n    }\n'
                 '    ClipVector normal = normalVectorTemp();\n    resolveEyeNormal(normal, vertexIndex, false);\n'
                 '    if (gpu.normalMap()) {\n        target.reflectX = normal.x;\n        target.reflectY = normal.y;\n'
                 '        target.reflectZ = normal.z;\n        return;\n    }\n'
                 '    ClipVector eye = eyeVectorTemp();\n    float length = vectorLength(eye.x, eye.y, eye.z);\n'
                 '    float scale = length > 0.000001f ? 1f / length : 0f;\n'
                 '    float ux = eye.x * scale;\n    float uy = eye.y * scale;\n    float uz = eye.z * scale;\n'
                 '    float twice = 2f * ((normal.x * ux) + (normal.y * uy) + (normal.z * uz));\n'
                 '    target.reflectX = ux - (normal.x * twice);\n    target.reflectY = uy - (normal.y * twice);\n'
                 '    target.reflectZ = uz - (normal.z * twice);\n}\n\n'
                 'public ReflectionUnit gpuReflectionUnit() {\n    return gpu == null ? null : gpu.reflection();\n}\n\n'
                 'static RasterVertex[] createRasterVertexArray(int length) {'),
            ]:
                assert text.count(old)==1,old
                text=text.replace(old,new)
            renderer=text
        if name=='OglSoftwareRenderer':
            old='        drawScratch.cacheVertex(vertexIndex, targetVertex);\n        return true;\n'
            assert text.count(old)==1,old
            text=text.replace(old,'        owner.gpuTexGen(targetVertex, vertexIndex);\n'+old)
        sources.append(write(rel,text))
    rel=Path('opendoja/host/DesktopSurface.java')
    text=(UP/rel).read_text(encoding='utf-8')
    text=text.replace('public DesktopSurface(int width, int height) {',
                      'public DesktopSurface(BufferedImage image) { this.image = image; }\n    public DesktopSurface(int width, int height) {')
    sources.append(write(rel,text))
    interface2=(UP/'com/nttdocomo/opt/ui/ogl/GraphicsOGL2.java').read_text(encoding='utf-8')
    sources.append(write('com/nttdocomo/ui/Graphics.java',adapter_source(renderer,interface2)))
    sources+=list((ROOT/'src-ogl').rglob('*.java'))
    clean_classes(CLASSES)
    compile_java(compiler,17,sources,CLASSES,ROOT/'build/ogl-sources.txt',ROOT/'web/p905i-runtime.jar')
    jar=ROOT/'web/p905i-ogl.jar'
    with zipfile.ZipFile(jar,'w',zipfile.ZIP_DEFLATED) as z:
        for p in sorted(CLASSES.rglob('*.class'),key=lambda p:p.as_posix()):add_file(z,p,p.relative_to(CLASSES).as_posix())
        add_file(z,ROOT/'vendor/openDoJa-master/LICENSE','META-INF/LICENSE-openDoJa.txt')
        add_notices(z)
        add_bytes(z,record(ROOT,'ogl'),RECORD)
    print('Built optional software OpenGL adapter:',jar,jar.stat().st_size)

if __name__=='__main__':build()
