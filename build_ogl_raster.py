# SPDX-License-Identifier: GPL-3.0-or-later
"""The rewritten OglRenderer pixel loop that build_ogl.py puts in place of the upstream one."""
import re

# The pixel loop of OglRenderer.rasterizeProjectedTriangle, from its texture lookup to the end of the method.
# Everything the per-pixel calls re-derived is read once per triangle, and the common texture paths are written
# out in place. Every expression keeps its operands and their order, so each pixel gets the value it had before.
RASTER_LOOP = r'''    boolean texturing = ogl.textureEnabled();
    OglTexture texture = texturing ? ogl.boundTexture() : null;
    boolean depthEnabled = ogl.depthEnabled();
    boolean blendEnabled = ogl.blendCapEnabled;
    boolean depthWriteEnabled = ogl.depthMask && depthEnabled;
    int depthFunc = ogl.depthFunc, srcFactor = ogl.blendSrcFactor, dstFactor = ogl.blendDstFactor;
    boolean[] alphaPass = ogl.alphaTestEnabled ? alphaPassTable() : null;
    boolean fogEnabled = fog.enabled;
    int c0 = useBackColor ? v0.backColor : v0.color, c1 = useBackColor ? v1.backColor : v1.color, c2 = useBackColor ? v2.backColor : v2.color;
    boolean constantColor = ogl.shadeModel == GraphicsOGL.GL_FLAT || (c0 == c1 && c1 == c2);
    int constantPrimary = ogl.shadeModel == GraphicsOGL.GL_FLAT ? c2 : c0;
    float a0 = (c0 >>> 24) & 0xFF, r0 = (c0 >>> 16) & 0xFF, g0 = (c0 >>> 8) & 0xFF, b0 = c0 & 0xFF;
    float a1 = (c1 >>> 24) & 0xFF, r1 = (c1 >>> 16) & 0xFF, g1 = (c1 >>> 8) & 0xFF, b1 = c1 & 0xFF;
    float a2 = (c2 >>> 24) & 0xFF, r2 = (c2 >>> 16) & 0xFF, g2 = (c2 >>> 8) & 0xFF, b2 = c2 & 0xFF;
    float depth0 = v0.depth, depth1 = v1.depth, depth2 = v2.depth;
    float u0 = v0.u, u1 = v1.u, u2 = v2.u, t0 = v0.v, t1 = v1.v, t2 = v2.v;
    boolean modulate = texture != null && ogl.textureEnvMode == GraphicsOGL.GL_MODULATE;
    int baseFormat = texture != null ? texture.baseFormat() : 0;
    boolean modulateAlpha = baseFormat != GraphicsOGL.GL_LUMINANCE && baseFormat != GraphicsOGL.GL_RGB;
    boolean modulateRgb = baseFormat != GraphicsOGL.GL_ALPHA;
    int[] texels = texture != null ? texture.pixels : null;
    int texWidth = texture != null ? texture.width : 0, texHeight = texture != null ? texture.height : 0;
    boolean texEmpty = texture == null || texels.length == 0 || texWidth <= 0 || texHeight <= 0;
    int wrapS = texture != null ? texture.wrapS : 0, wrapT = texture != null ? texture.wrapT : 0;
    boolean linear = texture != null && (texture.minFilter == GraphicsOGL.GL_LINEAR || texture.magFilter == GraphicsOGL.GL_LINEAR);
    float startX = minX + 0.5f;
    float startY = minY + 0.5f;
    float edge0Row = edge(v1.x, v1.y, v2.x, v2.y, startX, startY);
    float edge1Row = edge(v2.x, v2.y, v0.x, v0.y, startX, startY);
    float edge2Row = edge(v0.x, v0.y, v1.x, v1.y, startX, startY);
    float edge0StepX = v2.y - v1.y;
    float edge1StepX = v0.y - v2.y;
    float edge2StepX = v1.y - v0.y;
    float edge0StepY = v1.x - v2.x;
    float edge1StepY = v2.x - v0.x;
    float edge2StepY = v0.x - v1.x;
    for (int y = minY; y <= maxY; y++) {
        float edge0Value = edge0Row;
        float edge1Value = edge1Row;
        float edge2Value = edge2Row;
        for (int x = minX; x <= maxX; x++) {
            float w0 = edge0Value * inverseArea;
            float w1 = edge1Value * inverseArea;
            float w2 = edge2Value * inverseArea;
            edge0Value += edge0StepX;
            edge1Value += edge1StepX;
            edge2Value += edge2StepX;
            if (w0 < 0f || w1 < 0f || w2 < 0f) {
                continue;
            }
            float depth = (w0 * depth0) + (w1 * depth1) + (w2 * depth2);
            int offset = (y * width) + x;
            if (depthEnabled) {
                float existing = depthBuffer[offset];
                if (depthFunc == GraphicsOGL.GL_LESS ? !(depth > existing + 0.00001f) : !depthPasses(depthFunc, depth, existing)) {
                    continue;
                }
            }
            // Math.max(0.000001f, sum), NaN included.
            float denominator = (w0 * reciprocalW0) + (w1 * reciprocalW1) + (w2 * reciprocalW2);
            if (denominator <= 0.000001f) {
                denominator = 0.000001f;
            }
            int primaryColor;
            if (constantColor) {
                primaryColor = constantPrimary;
            } else {
                float redValue = ((w0 * r0 * reciprocalW0) + (w1 * r1 * reciprocalW1) + (w2 * r2 * reciprocalW2)) / denominator;
                float greenValue = ((w0 * g0 * reciprocalW0) + (w1 * g1 * reciprocalW1) + (w2 * g2 * reciprocalW2)) / denominator;
                float blueValue = ((w0 * b0 * reciprocalW0) + (w1 * b1 * reciprocalW1) + (w2 * b2 * reciprocalW2)) / denominator;
                float alphaValue = ((w0 * a0 * reciprocalW0) + (w1 * a1 * reciprocalW1) + (w2 * a2 * reciprocalW2)) / denominator;
                int red = ROUND(redValue), green = ROUND(greenValue), blue = ROUND(blueValue), alpha = ROUND(alphaValue);
                primaryColor = ((alpha < 0 ? 0 : alpha > 255 ? 255 : alpha) << 24) | ((red < 0 ? 0 : red > 255 ? 255 : red) << 16)
                        | ((green < 0 ? 0 : green > 255 ? 255 : green) << 8) | (blue < 0 ? 0 : blue > 255 ? 255 : blue);
            }
            int fragmentColor;
            if (texture == null) {
                fragmentColor = primaryColor;
            } else {
                float u = ((w0 * u0 * reciprocalW0) + (w1 * u1 * reciprocalW1) + (w2 * u2 * reciprocalW2)) / denominator;
                float v = ((w0 * t0 * reciprocalW0) + (w1 * t1 * reciprocalW1) + (w2 * t2 * reciprocalW2)) / denominator;
                int sampled;
                if (texEmpty) {
                    sampled = 0xFFFFFFFF;
                } else {
                    WRAP(su, u, wrapS)
                    WRAP(sv, v, wrapT)
                    if (linear) {
                        // OglTexture.bilinearSample: the weights sum to 65536, so no channel can leave 0..255.
                        float bx = su * (texWidth - 1), by = sv * (texHeight - 1);
                        int x0 = (int) bx, y0 = (int) by;
                        x0 = x0 < 0 ? 0 : x0 > texWidth - 1 ? texWidth - 1 : x0;
                        y0 = y0 < 0 ? 0 : y0 > texHeight - 1 ? texHeight - 1 : y0;
                        int x1 = x0 + 1 < texWidth ? x0 + 1 : x0, y1 = y0 + 1 < texHeight ? y0 + 1 : y0;
                        float fx = (bx - x0) * 256f, fy = (by - y0) * 256f;
                        int tx = ROUND(fx), ty = ROUND(fy);
                        tx = tx < 0 ? 0 : tx > 256 ? 256 : tx;
                        ty = ty < 0 ? 0 : ty > 256 ? 256 : ty;
                        int s00 = texels[(y0 * texWidth) + x0], s10 = texels[(y0 * texWidth) + x1];
                        int s01 = texels[(y1 * texWidth) + x0], s11 = texels[(y1 * texWidth) + x1];
                        int w00 = (256 - tx) * (256 - ty), w10 = tx * (256 - ty), w01 = (256 - tx) * ty, w11 = tx * ty;
                        sampled = (((((s00 >>> 24) * w00) + ((s10 >>> 24) * w10) + ((s01 >>> 24) * w01) + ((s11 >>> 24) * w11) + 32768) >> 16) << 24)
                                | (((((s00 >>> 16) & 0xFF) * w00) + (((s10 >>> 16) & 0xFF) * w10) + (((s01 >>> 16) & 0xFF) * w01) + (((s11 >>> 16) & 0xFF) * w11) + 32768) >> 16) << 16
                                | (((((s00 >>> 8) & 0xFF) * w00) + (((s10 >>> 8) & 0xFF) * w10) + (((s01 >>> 8) & 0xFF) * w01) + (((s11 >>> 8) & 0xFF) * w11) + 32768) >> 16) << 8
                                | ((((s00 & 0xFF) * w00) + ((s10 & 0xFF) * w10) + ((s01 & 0xFF) * w01) + ((s11 & 0xFF) * w11) + 32768) >> 16);
                    } else {
                        float fx = su * (texWidth - 1), fy = sv * (texHeight - 1);
                        int sx = ROUND(fx), sy = ROUND(fy);
                        sx = sx < 0 ? 0 : sx > texWidth - 1 ? texWidth - 1 : sx;
                        sy = sy < 0 ? 0 : sy > texHeight - 1 ? texHeight - 1 : sy;
                        sampled = texels[(sy * texWidth) + sx];
                    }
                }
                if (modulate) {
                    // applyModulateTextureFunction by texture format.
                    int alpha = (primaryColor >>> 24) & 0xFF;
                    if (modulateAlpha) {
                        alpha = ((alpha * ((sampled >>> 24) & 0xFF)) + 127) / 255;
                    }
                    fragmentColor = modulateRgb
                            ? (alpha << 24) | ((((((primaryColor >>> 16) & 0xFF) * ((sampled >>> 16) & 0xFF)) + 127) / 255) << 16)
                                | ((((((primaryColor >>> 8) & 0xFF) * ((sampled >>> 8) & 0xFF)) + 127) / 255) << 8)
                                | ((((primaryColor & 0xFF) * (sampled & 0xFF)) + 127) / 255)
                            : (alpha << 24) | (primaryColor & 0x00FFFFFF);
                } else {
                    fragmentColor = applyTextureEnvironment(primaryColor, sampled, texture);
                }
            }
            if (fogEnabled) {
                fragmentColor = fog.apply(fragmentColor, 1f / denominator);
            }
            if (alphaPass != null && !alphaPass[(fragmentColor >>> 24) & 0xFF]) {
                continue;
            }
            if (!blendEnabled) {
                pixels[offset] = fragmentColor;
            } else if (srcFactor == GraphicsOGL.GL_SRC_ALPHA && dstFactor == GraphicsOGL.GL_ONE_MINUS_SRC_ALPHA) {
                // blendSourceAlpha: the factors sum to 255, so no channel can leave 0..255.
                int sourceAlpha = fragmentColor >>> 24;
                if (sourceAlpha >= 255) {
                    pixels[offset] = fragmentColor;
                } else if (sourceAlpha > 0) {
                    int destination = pixels[offset], inverseAlpha = 255 - sourceAlpha;
                    pixels[offset] = ((((sourceAlpha * sourceAlpha) + ((destination >>> 24) * inverseAlpha) + 127) / 255) << 24)
                            | ((((((fragmentColor >>> 16) & 0xFF) * sourceAlpha) + (((destination >>> 16) & 0xFF) * inverseAlpha) + 127) / 255) << 16)
                            | ((((((fragmentColor >>> 8) & 0xFF) * sourceAlpha) + (((destination >>> 8) & 0xFF) * inverseAlpha) + 127) / 255) << 8)
                            | ((((fragmentColor & 0xFF) * sourceAlpha) + ((destination & 0xFF) * inverseAlpha) + 127) / 255);
                }
            } else {
                pixels[offset] = blend(fragmentColor, pixels[offset], srcFactor, dstFactor);
            }
            if (depthWriteEnabled) {
                depthBuffer[offset] = depth;
            }
        }
        edge0Row += edge0StepY;
        edge1Row += edge1StepY;
        edge2Row += edge2StepY;
    }
}

private static boolean depthPasses(int func, float incoming, float existing) {
    return switch (func) {
        case GraphicsOGL.GL_LESS -> incoming > existing + 0.00001f;
        case GraphicsOGL.GL_LEQUAL -> incoming >= existing - 0.00001f;
        case GraphicsOGL.GL_EQUAL -> Math.abs(incoming - existing) <= 0.00001f;
        case GraphicsOGL.GL_GREATER -> incoming < existing - 0.00001f;
        case GraphicsOGL.GL_GEQUAL -> incoming <= existing + 0.00001f;
        case GraphicsOGL.GL_ALWAYS -> true;
        case GraphicsOGL.GL_NEVER -> false;
        default -> incoming > existing + 0.00001f;
    };
}

// passesAlphaTestAlpha for each alpha byte, rebuilt only when the test function or reference changes.
private final boolean[] alphaPass = new boolean[256];
private int alphaPassFunc = -1;
private float alphaPassRef = Float.NaN;
private boolean[] alphaPassTable() {
    if (ogl.alphaFunc != alphaPassFunc || !(ogl.alphaRef == alphaPassRef)) {
        for (int alpha = 0; alpha < 256; alpha++) {
            alphaPass[alpha] = passesAlphaTestAlpha(alpha);
        }
        alphaPassFunc = ogl.alphaFunc;
        alphaPassRef = ogl.alphaRef;
    }
    return alphaPass;
}
'''
# A call costs about as much as the arithmetic around it under CheerpJ, so ExactMath.round and
# OglTexture.wrapCoordinate (with ExactMath.fraction) are written out in place of ROUND and WRAP.
RASTER_LOOP=re.sub(r'ROUND\((\w+)\)',lambda m:f'({m[1]} >= -0.5f && {m[1]} < 2147483648f ? (int) ((double) {m[1]} + 0.5d) : Math.round({m[1]}))',RASTER_LOOP)
RASTER_LOOP=re.sub(r'( *)WRAP\((\w+), (\w+), (\w+)\)\n',lambda m:'\n'.join(m[1]+line for line in [
    f'float {m[2]};',
    f'if ({m[4]} == GraphicsOGL.GL_CLAMP_TO_EDGE) {{',
    f'    {m[2]} = {m[3]} != {m[3]} ? {m[3]} : {m[3]} >= 1f ? 1f : {m[3]} <= 0f ? 0f : {m[3]};',
    f'}} else {{',
    f'    if ({m[3]} > -8388608f && {m[3]} < 8388608f) {{',
    f'        int whole = (int) {m[3]};',
    f'        {m[2]} = ({m[3]} - (whole > {m[3]} ? whole - 1 : whole)) + 0f;',
    f'    }} else {{',
    f'        {m[2]} = {m[3]} - (float) Math.floor({m[3]});',
    f'    }}',
    f'    {m[2]} = {m[2]} < 0f ? {m[2]} + 1f : {m[2]};',
    f'}}'])+'\n',RASTER_LOOP)
assert 'ROUND(' not in RASTER_LOOP and 'WRAP(' not in RASTER_LOOP
