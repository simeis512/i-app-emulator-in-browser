package p905i.web;

/** Math.round and Math.floor results for the per-pixel path. Both run through bit-conversion natives under CheerpJ,
 * which made them the costliest part of textured drawing. Each method returns what the original expression returns,
 * bit for bit, for every input; values outside the fast range take the original expression. GPL-3.0-or-later. */
public final class ExactMath {
    private ExactMath() {}
    /** Math.round(value). From -0.5 and below 2^31 the double sum is exact and not negative, so truncation floors it. */
    public static int round(float value) {
        return value >= -0.5f && value < 2147483648f ? (int)((double)value+0.5d) : Math.round(value);
    }
    /** value - (float)Math.floor(value). Below 2^23 the integer part fits an int exactly; adding 0 turns the -0 left by
     * -0 into the +0 the original gives. */
    public static float fraction(float value) {
        if(value > -8388608f && value < 8388608f){int whole=(int)value;if(whole > value)whole--;return (value-whole)+0f;}
        return value-(float)Math.floor(value);
    }
}
