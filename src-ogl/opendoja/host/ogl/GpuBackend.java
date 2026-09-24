package opendoja.host.ogl;

import com.nttdocomo.ui.ogl.GraphicsOGL;
import java.awt.Rectangle;
import java.awt.image.BufferedImage;
import java.awt.image.DataBufferInt;
import java.util.HashSet;
import java.util.IdentityHashMap;
import java.util.Map;
import java.util.Set;
import p905i.web.BrowserRuntime;
import p905i.web.WebGl;

/** Experimental WebGL2 renderer for the browser (i-app-emulator-in-browser, GPL-3.0-or-later). The software pipeline
 * still fetches, transforms, lights and clips; each projected triangle is recorded here instead of being rasterised,
 * with the state of its draw call, and a 3D section goes to the browser in one batch. Colour is one GPU texture per
 * image, shared by the renderers drawing on it; depth belongs to each renderer, as in the software path. */
final class GpuBackend {
    static final int COMMAND = 37, DRAW = 1, CLEAR_DEPTH = 2, FLOATS = 10;
    private static final int MAX_VERTICES = 3 * 21000;
    private static int enabled = -1;
    private static final Map<BufferedImage, Integer> targets = new IdentityHashMap<>();
    private static final Set<String> noticed = new HashSet<>();
    /** GPU texture key and the upload revision it holds, per texture object; textures are shared by all renderers. */
    private static final Map<OglRenderer.OglTexture, int[]> textures = new IdentityHashMap<>();
    private static int nextTexture;

    /** Null unless the page asked for the experimental renderer and WebGL2 is there. */
    static GpuBackend create(OglRenderer renderer) {
        if (enabled < 0) {
            boolean wanted = "webgl".equals(System.getProperty("p905i.gpu"));
            enabled = wanted && WebGl.available() ? 1 : 0;
            if (wanted) BrowserRuntime.recordLog(enabled == 1 ? "3D: experimental WebGL2 renderer"
                    : "3D: WebGL2 is not available; drawing in software");
        }
        return enabled == 1 ? new GpuBackend(renderer) : null;
    }

    /** Logs each unsupported state once, so an experimental frame is never silently wrong. */
    static void notice(String what) {
        if (noticed.add(what)) BrowserRuntime.recordLog("3D WebGL2: " + what);
    }

    private final OglRenderer renderer;
    private BufferedImage image;
    private int[] pixels;
    private int width, height, target = -1, surface = -1;
    private float[] vertices = new float[6 * 3 * 256];
    private int[] colors = new int[3 * 256];
    private int vertexCount;
    private int[] commands = new int[COMMAND * 32];
    private float[] floats = new float[FLOATS * 32];
    private int commandCount;
    private final int[] state = new int[COMMAND];
    private final float[] stateFloats = new float[FLOATS];
    private boolean section, implicit, uploaded, drawn;
    private int colorMask = 15;
    private int drawFirst;

    private GpuBackend(OglRenderer renderer) {
        this.renderer = renderer;
    }

    private void bind() {
        BufferedImage current = renderer.host().surface().image();
        if (current == image) return;
        image = current;
        width = image.getWidth();
        height = image.getHeight();
        pixels = ((DataBufferInt) image.getRaster().getDataBuffer()).getData();
        Integer shared = targets.get(image);
        if (shared == null) targets.put(image, shared = WebGl.target(width, height));
        target = shared;
        surface = WebGl.surface(target);
        uploaded = false;
    }

    /** The GPU copy of the picture starts from the CPU picture before anything is drawn over it. */
    private void prepare() {
        bind();
        if (!uploaded) {
            WebGl.upload(target, pixels, width, height);
            uploaded = true;
        }
    }

    void begin() {
        section = true;
    }

    void end() {
        flush();
        section = false;
    }

    /** Sends what is recorded. Readback happens only when the section ends or the CPU is about to use the picture. */
    void submit() {
        if (commandCount > 0) WebGl.draw(surface, vertices, colors, vertexCount, commands, commandCount, floats);
        vertexCount = 0;
        commandCount = 0;
        drawFirst = 0;
    }

    /** Brings the CPU picture up to date; the next GPU drawing starts again from it. */
    void flush() {
        submit();
        if (drawn) WebGl.readback(surface, pixels, width, height);
        drawn = false;
        uploaded = false;
    }

    /** The CPU is about to write the picture itself (a colour clear or a line), so both copies must agree first. */
    void cpuWrite() {
        flush();
    }

    void clear(int mask) {
        if ((mask & GraphicsOGL.GL_DEPTH_BUFFER_BIT) != 0) {
            bind();
            capture(null);
            command(CLEAR_DEPTH, 0, 0);
            if (!section) submit();
        }
        if ((mask & GraphicsOGL.GL_COLOR_BUFFER_BIT) != 0) cpuWrite();
    }

    /** glColorMask as red, green, blue and alpha bits; the adapter no longer masks GPU draws on the CPU. */
    void colorMask(boolean red, boolean green, boolean blue, boolean alpha) {
        colorMask = (red ? 1 : 0) | (green ? 2 : 0) | (blue ? 4 : 0) | (alpha ? 8 : 0);
    }

    void beginDraw(Rectangle clip) {
        if (!section) {
            section = true;
            implicit = true;
        }
        prepare();
        capture(clip);
        OglRenderer.OglState ogl = renderer.oglState();
        if (ogl.textureEnabled() && ogl.textureEnvMode == GraphicsOGL.GL_COMBINE) notice("GL_COMBINE is drawn as GL_MODULATE");
        drawFirst = vertexCount;
    }

    void endDraw() {
        if (vertexCount > drawFirst) {
            command(DRAW, drawFirst, vertexCount - drawFirst);
            drawn = true;
        }
        if (implicit) {
            implicit = false;
            end();
        }
    }

    void triangle(OglRenderer.RasterVertex v0, OglRenderer.RasterVertex v1, OglRenderer.RasterVertex v2, boolean back) {
        if (vertexCount + 3 > vertices.length / 6) grow();
        int c2 = back ? v2.backColor : v2.color;
        boolean flat = renderer.oglState().shadeModel == GraphicsOGL.GL_FLAT;
        put(v0, flat ? c2 : back ? v0.backColor : v0.color);
        put(v1, flat ? c2 : back ? v1.backColor : v1.color);
        put(v2, c2);
    }

    private void put(OglRenderer.RasterVertex v, int color) {
        int i = vertexCount * 6;
        vertices[i] = v.clipX;
        vertices[i + 1] = v.clipY;
        vertices[i + 2] = v.clipZ;
        vertices[i + 3] = v.clipW;
        vertices[i + 4] = v.u;
        vertices[i + 5] = v.v;
        colors[vertexCount++] = color;
    }

    /** Grows the batch, or sends it and starts a new one when it is already at its limit. */
    private void grow() {
        if (vertices.length / 6 >= MAX_VERTICES) {
            if (vertexCount > drawFirst) {
                command(DRAW, drawFirst, vertexCount - drawFirst);
                drawn = true;
            }
            submit();
            return;
        }
        vertices = java.util.Arrays.copyOf(vertices, vertices.length * 2);
        colors = java.util.Arrays.copyOf(colors, colors.length * 2);
    }

    /** The state of the draw call about to be recorded. */
    private void capture(Rectangle clip) {
        OglRenderer.OglState ogl = renderer.oglState();
        java.util.Arrays.fill(state, 0);
        java.util.Arrays.fill(stateFloats, 0f);
        state[3] = ogl.viewportX;
        state[4] = ogl.viewportY;
        state[5] = ogl.viewportWidth;
        state[6] = ogl.viewportHeight;
        if (clip != null) {
            // DoJa clips are in picture rows from the top; the GPU counts rows from the bottom.
            state[7] = 1;
            state[8] = clip.x;
            state[9] = height - (clip.y + clip.height);
            state[10] = clip.width;
            state[11] = clip.height;
        }
        // The software path compares reversed depth in the reversed direction, so GL's own functions match it.
        state[12] = ogl.depthEnabled() ? 1 : 0;
        state[13] = ogl.depthFunc;
        state[14] = ogl.depthMask ? 1 : 0;
        stateFloats[1] = ogl.depthRangeNear;
        stateFloats[2] = ogl.depthRangeFar;
        state[27] = colorMask;
        state[36] = renderer.fogForGpu().copyTo(stateFloats, 3);
        // GPU blending rounds its own way; software rounds integer sums. The alpha test is the software table itself.
        state[15] = ogl.blendCapEnabled ? 1 : 0;
        state[16] = ogl.blendSrcFactor;
        state[17] = ogl.blendDstFactor;
        boolean[] pass = renderer.alphaPassForGpu();
        if (pass != null) {
            state[26] = 1;
            for (int alpha = 0; alpha < 256; alpha++) if (pass[alpha]) state[28 + (alpha >> 5)] |= 1 << (alpha & 31);
        }
        OglRenderer.OglTexture texture = ogl.textureEnabled() ? ogl.boundTexture() : null;
        if (texture != null) {
            boolean empty = texture.pixels.length == 0 || texture.width <= 0 || texture.height <= 0;
            state[18] = 1;
            state[19] = empty ? -1 : textureKey(texture);
            state[20] = texture.width;
            state[21] = texture.height;
            state[22] = (texture.minFilter == GraphicsOGL.GL_LINEAR || texture.magFilter == GraphicsOGL.GL_LINEAR ? 1 : 0)
                    | (texture.wrapS == GraphicsOGL.GL_CLAMP_TO_EDGE ? 2 : 0) | (texture.wrapT == GraphicsOGL.GL_CLAMP_TO_EDGE ? 4 : 0);
            state[23] = ogl.textureEnvMode;
            state[24] = texture.baseFormat();
            state[25] = ogl.textureEnvColor;
        }
    }

    /** Uploads a texture when its contents changed; draws already recorded used the old contents, so they go first. */
    private int textureKey(OglRenderer.OglTexture texture) {
        int[] known = textures.get(texture);
        if (known == null) textures.put(texture, known = new int[]{nextTexture++, -1});
        if (known[1] != texture.uploadRevision()) {
            if (commandCount > 0) submit();
            WebGl.texture(known[0], texture.pixels, texture.width, texture.height);
            known[1] = texture.uploadRevision();
        }
        return known[0];
    }

    private void command(int type, int first, int count) {
        if ((commandCount + 1) * COMMAND > commands.length) {
            commands = java.util.Arrays.copyOf(commands, commands.length * 2);
            floats = java.util.Arrays.copyOf(floats, floats.length * 2);
        }
        int o = commandCount * COMMAND;
        System.arraycopy(state, 0, commands, o, COMMAND);
        commands[o] = type;
        commands[o + 1] = first;
        commands[o + 2] = count;
        System.arraycopy(stateFloats, 0, floats, commandCount * FLOATS, FLOATS);
        commandCount++;
    }
}
