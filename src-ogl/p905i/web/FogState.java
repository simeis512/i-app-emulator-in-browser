package p905i.web;

/** Fixed-function fog for the perspective triangle path. GPL-3.0-or-later. */
public final class FogState {
    public boolean enabled;
    private int mode=0x0800;
    private float density=1, start=0, end=1;
    private final float[] color={0,0,0,0};
    public void parameter(int pname,float value) {
        switch(pname) {
            case 0x0B65:mode=(int)value;break;
            case 0x0B62:density=value;break;
            case 0x0B63:start=value;break;
            case 0x0B64:end=value;break;
            default:throw new IllegalArgumentException("fog parameter: "+pname);
        }
    }
    public void parameter(int pname,float[] values) {
        if(pname==0x0B66)System.arraycopy(values,0,color,0,4);
        else parameter(pname,values[0]);
    }
    public int apply(int argb,float distance) {
        if(!enabled)return argb;
        float f;
        if(mode==0x2601)f=end==start?(distance<=start?1:0):(end-distance)/(end-start);
        else if(mode==0x0801)f=(float)Math.exp(-density*density*distance*distance);
        else f=(float)Math.exp(-density*distance);
        f=Math.max(0,Math.min(1,f));int result=argb&0xff000000;
        for(int i=0;i<3;i++) {
            int shift=16-8*i;
            int c=Math.round(((argb>>>shift)&255)*f+Math.max(0,Math.min(1,color[i]))*255*(1-f));
            result|=c<<shift;
        }
        return result;
    }
}
