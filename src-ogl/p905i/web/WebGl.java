package p905i.web;

/** Browser WebGL2 calls for the experimental GPU renderer, implemented in web/gl3d.mjs. All are synchronous: Java
 * arrays are read or filled during the call and not kept. GPL-3.0-or-later. */
public final class WebGl {
    private WebGl() {}
    /** Whether a WebGL2 context could be created. */
    public static native boolean available();
    /** A colour texture for one image; the id is shared by every Graphics drawing on that image. */
    public static native int target(int width, int height);
    /** A framebuffer drawing into a target, with its own depth buffer. */
    public static native int surface(int target);
    /** Copies an ARGB image (top row first) into a target. */
    public static native void upload(int target, int[] argb, int width, int height);
    /** Copies a surface's colour back into an ARGB image (top row first). */
    public static native void readback(int surface, int[] argb, int width, int height);
    /** Stores texture contents (ARGB, rows as the texture's t coordinate grows) under a key. */
    public static native void texture(int key, int[] argb, int width, int height);
    /** Frees the texture stored under a key. */
    public static native void deleteTexture(int key);
    /** Draws a batch: six floats per vertex (clip x, y, z, w, u, v), one ARGB colour per vertex, and fixed-size
     * command records with their float parameters, in order. */
    public static native void draw(int surface, float[] vertices, int[] colors, int vertexCount, int[] commands, int commandCount, float[] floats);
}
