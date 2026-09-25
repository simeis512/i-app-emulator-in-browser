package opendoja.host.ogl;

import com.nttdocomo.opt.ui.ogl.GraphicsOGL2;
import com.nttdocomo.ui.ogl.ByteBuffer;
import com.nttdocomo.ui.ogl.DirectBuffer;
import com.nttdocomo.ui.ogl.DirectBufferFactory;
import com.nttdocomo.ui.ogl.GraphicsOGL;
import java.util.HashMap;
import java.util.Map;

/** Texture unit 1 for the experimental WebGL2 renderer (i-app-emulator-in-browser, GPL-3.0-or-later): a cube map
 * addressed by reflection or normal coordinates generated per vertex, applied after unit 0 with its own texture
 * function. The software renderer does not draw this unit, so the adapter routes unit-1 calls here only while the GPU
 * renderer is active. Method names follow the GL calls they stand for. */
public final class ReflectionUnit {
    /** Six faces in GL order (+X, -X, +Y, -Y, +Z, -Z); a revision marks new contents for the GPU. */
    static final class Cube {
        final OglRenderer.OglTexture[] faces = new OglRenderer.OglTexture[6];
        int minFilter = GraphicsOGL.GL_NEAREST, magFilter = GraphicsOGL.GL_NEAREST, revision;

        /** Either filter linear draws linear, as unit 0 does; mipmaps are never sampled. */
        boolean linear() {
            return minFilter == GraphicsOGL.GL_LINEAR || magFilter == GraphicsOGL.GL_LINEAR;
        }

        /** Complete as GL requires: six square faces of one size and base format. */
        boolean complete() {
            OglRenderer.OglTexture first = faces[0];
            if (first == null || first.width != first.height || first.pixels.length == 0) return false;
            for (OglRenderer.OglTexture face : faces)
                if (face == null || face.width != first.width || face.height != first.height || face.baseFormat != first.baseFormat) return false;
            return true;
        }
    }

    private final Map<Integer, Cube> cubes = new HashMap<>();
    private boolean texture2d, cubeMap, texGen;
    private int texGenMode = GraphicsOGL2.GL_REFLECTION_MAP, boundCube;
    int envMode = GraphicsOGL.GL_MODULATE, envColor;

    public void glEnable(int cap) {
        set(cap, true);
    }

    public void glDisable(int cap) {
        set(cap, false);
    }

    private void set(int cap, boolean on) {
        if (cap == GraphicsOGL.GL_TEXTURE_2D) texture2d = on;
        else if (cap == GraphicsOGL2.GL_TEXTURE_CUBE_MAP) cubeMap = on;
        else if (cap == GraphicsOGL2.GL_TEXTURE_GEN_STR) texGen = on;
    }

    public void glBindTexture(int target, int texture) {
        if (target == GraphicsOGL2.GL_TEXTURE_CUBE_MAP) {
            boundCube = texture;
            if (texture != 0) cubes.computeIfAbsent(texture, ignored -> new Cube());
        } else if (target == GraphicsOGL.GL_TEXTURE_2D && texture != 0) GpuBackend.notice("a second 2D texture is not drawn");
    }

    public void glCompressedTexImage2D(int target, int level, int internalformat, int width, int height, int border, int imageSize,
            DirectBuffer pixels) {
        OglRenderer.OglTexture face = face(target, level, border);
        if (face == null || !(pixels instanceof ByteBuffer bytes)) return;
        byte[] raw = new byte[Math.max(0, imageSize)];
        bytes.get(DirectBufferFactory.getSegmentOffset(bytes), raw, 0, raw.length);
        if (face.loadCompressed(internalformat, width, height, raw)) changed();
    }

    public void glCompressedTexImage2D(int target, int level, int internalformat, int width, int height, int border, ByteBuffer pixels) {
        if (pixels == null) throw new NullPointerException("pixels");
        glCompressedTexImage2D(target, level, internalformat, width, height, border, pixels.length(), pixels);
    }

    public void glTexImage2D(int target, int level, int internalformat, int width, int height, int border, int format, int type,
            DirectBuffer pixels) {
        OglRenderer.OglTexture face = face(target, level, border);
        if (face != null && width > 0 && height > 0 && face.loadUncompressed(width, height, format, type, pixels)) changed();
    }

    /** The face of the bound cube a cube-face target names, created on first use; other targets are not drawn. */
    private OglRenderer.OglTexture face(int target, int level, int border) {
        int index = target - GraphicsOGL2.GL_TEXTURE_CUBE_MAP_POSITIVE_X;
        Cube cube = cubes.get(boundCube);
        if (index < 0 || index > 5 || cube == null) {
            GpuBackend.notice("a second 2D texture is not drawn");
            return null;
        }
        if (level != 0 || border != 0) return null;
        if (cube.faces[index] == null) cube.faces[index] = new OglRenderer.OglTexture();
        return cube.faces[index];
    }

    private void changed() {
        cubes.get(boundCube).revision++;
    }

    public void glTexParameterf(int target, int pname, float param) {
        glTexParameteri(target, pname, (int) param);
    }

    public void glTexParameteri(int target, int pname, int param) {
        Cube cube = cubes.get(boundCube);
        if (target != GraphicsOGL2.GL_TEXTURE_CUBE_MAP || cube == null) return;
        // The filter goes with each draw, so it needs no new upload of the faces.
        if (pname == GraphicsOGL.GL_TEXTURE_MIN_FILTER) cube.minFilter = param;
        else if (pname == GraphicsOGL.GL_TEXTURE_MAG_FILTER) cube.magFilter = param;
    }

    public void glTexEnvf(int target, int pname, float param) {
        glTexEnvi(target, pname, (int) param);
    }

    public void glTexEnvi(int target, int pname, int param) {
        if (target == GraphicsOGL.GL_TEXTURE_ENV && pname == GraphicsOGL.GL_TEXTURE_ENV_MODE) envMode = param;
    }

    public void glTexEnvfv(int target, int pname, float[] params) {
        if (params == null) throw new NullPointerException("params");
        if (target != GraphicsOGL.GL_TEXTURE_ENV) return;
        if (pname == GraphicsOGL.GL_TEXTURE_ENV_COLOR && params.length >= 4)
            envColor = channel(params[3]) << 24 | channel(params[0]) << 16 | channel(params[1]) << 8 | channel(params[2]);
        else if (params.length > 0) glTexEnvi(target, pname, (int) params[0]);
    }

    /** As the renderer packs unit 0's colour. */
    private static int channel(float value) {
        return Float.isNaN(value) ? 0 : Math.round(Math.max(0f, Math.min(1f, value)) * 255f);
    }

    public void glTexGenf(int coord, int pname, float param) {
        glTexGeni(coord, pname, (int) param);
    }

    public void glTexGenfv(int coord, int pname, float[] params) {
        if (params == null) throw new NullPointerException("params");
        if (params.length > 0) glTexGeni(coord, pname, (int) params[0]);
    }

    public void glTexGeniv(int coord, int pname, int[] params) {
        if (params == null) throw new NullPointerException("params");
        if (params.length > 0) glTexGeni(coord, pname, params[0]);
    }

    public void glTexGeni(int coord, int pname, int param) {
        if (coord == GraphicsOGL2.GL_STR && pname == GraphicsOGL2.GL_TEXTURE_GEN_MODE) texGenMode = param;
    }

    public void glGetTexGenfv(int coord, int pname, float[] params) {
        if (params == null) throw new NullPointerException("params");
        if (coord == GraphicsOGL2.GL_STR && pname == GraphicsOGL2.GL_TEXTURE_GEN_MODE && params.length > 0) params[0] = texGenMode;
    }

    public void glGetTexGeniv(int coord, int pname, int[] params) {
        if (params == null) throw new NullPointerException("params");
        if (coord == GraphicsOGL2.GL_STR && pname == GraphicsOGL2.GL_TEXTURE_GEN_MODE && params.length > 0) params[0] = texGenMode;
    }

    /** Deleted names free their cubes; texture names are shared with the 2D textures the renderer deletes. */
    public void deleteTextures(int n, int[] textures) {
        if (textures == null) return;
        for (int i = 0; i < Math.min(n, textures.length); i++) {
            int texture = textures[i];
            Cube cube = cubes.remove(texture);
            if (cube != null) GpuBackend.forget(cube);
            if (boundCube == texture) boundCube = 0;
        }
    }

    boolean normalMap() {
        return texGenMode == GraphicsOGL2.GL_NORMAL_MAP;
    }

    /** The cube the next draw applies, or null when unit 1 is off. A use the GPU cannot draw is reported once and left
     * out, as GL leaves out a unit whose texture is incomplete. */
    Cube active() {
        if (!cubeMap) {
            if (texture2d) GpuBackend.notice("a second 2D texture is not drawn");
            return null;
        }
        if (!texGen) {
            GpuBackend.notice("cube map coordinates from an array are not drawn");
            return null;
        }
        if (texGenMode != GraphicsOGL2.GL_REFLECTION_MAP && texGenMode != GraphicsOGL2.GL_NORMAL_MAP) {
            GpuBackend.notice("texture generation mode " + texGenMode + " is not drawn");
            return null;
        }
        Cube cube = cubes.get(boundCube);
        if (cube == null || !cube.complete()) {
            GpuBackend.notice("an incomplete cube map is not drawn");
            return null;
        }
        return cube;
    }
}
