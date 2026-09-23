import java.util.Arrays;
import org.recompile.mobile.*;
import com.nttdocomo.ui.Graphics;
import com.nttdocomo.ui.ogl.*;
import opendoja.host.ogl.HostDirectBuffers.HostByteBuffer;
import opendoja.host.ogl.HostDirectBuffers.HostFloatBuffer;
import p905i.web.ExactMath;
import static com.nttdocomo.ui.ogl.GraphicsOGL.*;

/** Pixel-level integration checks against the compiled bridge and renderer. */
public final class OglChecks {
    static void require(boolean ok,String message) {
        if(!ok)throw new AssertionError(message);
        System.out.println("PASS "+message);
    }
    public static void main(String[] args) {
        try {
            Mobile.isDoJa=true;Mobile.DoJaVersion=51;Mobile.maskIndex=0;
            Mobile.minLogLevel=Mobile.LOG_NONE;
            Mobile.setPlatform(new MobilePlatform(32,32),()->{});
            PlatformImage image=new PlatformImage(32,32);
            Graphics g=image.getDoJaGraphics();int[] pixels=image.getDataBuffer();
            Arrays.fill(pixels,0xff204060);
            g.glColorMask(true,false,false,false);
            g.glClearColor(1,1,1,1);g.glClear(GL_COLOR_BUFFER_BIT);
            require(pixels[16*32+16]==0xffff4060,"color mask preserves disabled channels on clear");
            g.glColorMask(true,true,true,true);
            g.glClearColor(0,0,0,1);g.glClear(GL_COLOR_BUFFER_BIT|GL_DEPTH_BUFFER_BIT);
            g.beginDrawing();g.glViewport(0,0,32,32);
            g.glMatrixMode(GL_PROJECTION);g.glLoadIdentity();
            g.glMatrixMode(GL_MODELVIEW);g.glLoadIdentity();
            g.glDisable(GL_CULL_FACE);g.glDisable(GL_TEXTURE_2D);
            g.glEnableClientState(GL_VERTEX_ARRAY);
            FloatBuffer triangle=new HostFloatBuffer(new float[]{-.8f,-.8f,0,.8f,-.8f,0,0,.8f,0});
            g.glVertexPointer(3,GL_FLOAT,0,triangle);g.glColor4f(1,0,0,1);
            g.glDrawArrays(GL_TRIANGLES,0,3);g.endDrawing();
            require((pixels[16*32+16]&0xffffff)==0xff0000,"triangle reaches the shared 2D framebuffer");
            require((pixels[0]&0xffffff)==0,"triangle leaves the exterior untouched");

            // The supported fog path uses perspective distance (w = 2 here).
            g.glClear(GL_COLOR_BUFFER_BIT|GL_DEPTH_BUFFER_BIT);g.beginDrawing();
            g.glMatrixMode(GL_PROJECTION);g.glLoadIdentity();g.glFrustumf(-1,1,-1,1,1,10);
            g.glMatrixMode(GL_MODELVIEW);g.glLoadIdentity();
            triangle.put(0,new float[]{-1.5f,-1.5f,-2,1.5f,-1.5f,-2,0,1.5f,-2});
            g.glFogf(GL_FOG_MODE,GL_LINEAR);g.glFogf(GL_FOG_START,1);g.glFogf(GL_FOG_END,3);
            g.glFogfv(GL_FOG_COLOR,new float[]{0,0,1,1});g.glEnable(GL_FOG);
            g.glDrawArrays(GL_TRIANGLES,0,3);g.endDrawing();
            int center=pixels[16*32+16];
            require(((center>>16)&255)>=125 && ((center>>16)&255)<=130 && (center&255)>=125 && (center&255)<=130,
                    "perspective triangle mixes fog at its distance");

            // ExactMath replaces Math.round and Math.floor in the per-pixel path, so it must agree for every input:
            // the edges of its fast ranges, half-integers, huge values, zeros of both signs, infinities and NaN.
            java.util.Random random=new java.util.Random(5);int mismatches=0;
            float[] edges={0f,-0f,.5f,-.5f,Math.nextDown(.5f),Math.nextUp(-.5f),Math.nextDown(-.5f),1.5f,-1.5f,-2.5f,.99999994f,-.99999994f,
                8388607.5f,-8388607.5f,8388608f,-8388608f,2147483520f,2147483648f,-2147483648f,2147483904f,-2147483904f,1e-30f,-1e-30f,
                Float.MIN_VALUE,-Float.MIN_VALUE,Float.MAX_VALUE,-Float.MAX_VALUE,Float.POSITIVE_INFINITY,Float.NEGATIVE_INFINITY,Float.NaN};
            for(int i=0;i<3_000_000;i++){
                float v=i<edges.length?edges[i]:i%3==0?Float.intBitsToFloat(random.nextInt()):i%3==1?(random.nextFloat()-.5f)*(1L<<random.nextInt(34))
                    :(i&4)==0?Math.nextDown(random.nextInt(1<<25)-(1<<24)+.5f):Math.nextUp(random.nextInt(1<<25)-(1<<24)+.5f);
                if(ExactMath.round(v)!=Math.round(v))mismatches++;
                if(Float.floatToIntBits(ExactMath.fraction(v))!=Float.floatToIntBits(v-(float)Math.floor(v)))mismatches++;
            }
            require(mismatches==0,"ExactMath agrees with Math.round and Math.floor bit for bit");

            // Textured drawing through every replaced call: repeated negative coordinates, nearest and linear filters,
            // colour interpolation, coordinates past 2^23 and 2^31, alpha test and fog. The checksums were taken from
            // the renderer before ExactMath; change them only when drawing is meant to change.
            PlatformImage scene=new PlatformImage(64,48);Graphics s=scene.getDoJaGraphics();int[] sp=scene.getDataBuffer();
            byte[] texels=new byte[64];
            for(int i=0;i<16;i++){int c=((i^(i>>2))&1)==0?0xff:0x20;texels[i*4]=(byte)c;texels[i*4+1]=(byte)(i*16);texels[i*4+2]=(byte)(255-c);texels[i*4+3]=(byte)(i==5?0:i==10?0x70:0xff);}
            s.beginDrawing();s.glViewport(0,0,64,48);s.glClearColor(0,0,0,1);s.glClear(GL_COLOR_BUFFER_BIT|GL_DEPTH_BUFFER_BIT);
            int[] name=new int[1];s.glGenTextures(1,name);s.glBindTexture(GL_TEXTURE_2D,name[0]);
            s.glTexImage2D(GL_TEXTURE_2D,0,GL_RGBA,4,4,0,GL_RGBA,GL_UNSIGNED_BYTE,new HostByteBuffer(texels));
            s.glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_WRAP_S,GL_REPEAT);s.glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_WRAP_T,GL_REPEAT);
            s.glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,GL_NEAREST);s.glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,GL_NEAREST);
            s.glEnable(GL_TEXTURE_2D);s.glTexEnvi(GL_TEXTURE_ENV,GL_TEXTURE_ENV_MODE,GL_MODULATE);s.glShadeModel(GL_SMOOTH);s.glDisable(GL_CULL_FACE);
            s.glMatrixMode(GL_PROJECTION);s.glLoadIdentity();s.glFrustumf(-1,1,-.75f,.75f,1,10);s.glMatrixMode(GL_MODELVIEW);s.glLoadIdentity();
            s.glEnableClientState(GL_VERTEX_ARRAY);s.glEnableClientState(GL_TEXTURE_COORD_ARRAY);s.glEnableClientState(GL_COLOR_ARRAY);
            FloatBuffer quad=new HostFloatBuffer(new float[]{-2,-1.5f,-2, 2,-1.5f,-2, -1,1.5f,-5, 2,-1.5f,-2, 1,1.5f,-5, -1,1.5f,-5});
            FloatBuffer coords=new HostFloatBuffer(new float[]{-3.25f,-2.5f, 5.75f,-2.5f, -3.25f,7.5f, 5.75f,-2.5f, 5.75f,7.5f, -3.25f,7.5f});
            FloatBuffer colours=new HostFloatBuffer(new float[]{1,.2f,.2f,1, .2f,1,.2f,1, .2f,.2f,1,1, .2f,1,.2f,1, 1,1,1,1, .2f,.2f,1,1});
            s.glVertexPointer(3,GL_FLOAT,0,quad);s.glTexCoordPointer(2,GL_FLOAT,0,coords);s.glColorPointer(4,GL_FLOAT,0,colours);
            s.glDrawArrays(GL_TRIANGLES,0,6);s.endDrawing();
            require(Arrays.hashCode(sp)==0x99062d87 && Arrays.stream(sp).distinct().count()>1000,
                    "nearest repeated texture with colour interpolation draws as before");
            s.beginDrawing();s.glClear(GL_COLOR_BUFFER_BIT|GL_DEPTH_BUFFER_BIT);
            s.glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,GL_LINEAR);s.glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,GL_LINEAR);
            coords.put(0,new float[]{-1.5e7f,.25f, 9.5e6f,.25f, -1.5e7f,-3e9f, 9.5e6f,.25f, 9.5e6f,-3e9f, -1.5e7f,-3e9f});
            quad.put(0,new float[]{-2,-1.5f,-2, 2,-1.5f,-2, -2,1.5f,-2, 2,-1.5f,-2, 2,1.5f,-2, -2,1.5f,-2});
            s.glEnable(GL_ALPHA_TEST);s.glAlphaFunc(GL_GREATER,.5f);
            s.glFogf(GL_FOG_MODE,GL_LINEAR);s.glFogf(GL_FOG_START,1);s.glFogf(GL_FOG_END,4);s.glFogfv(GL_FOG_COLOR,new float[]{.1f,.3f,.9f,1});
            s.glEnable(GL_FOG);s.glDrawArrays(GL_TRIANGLES,0,6);
            coords.put(0,new float[]{-.75f,-1.25f, 1.25f,-1.25f, -.75f,2.25f, 1.25f,-1.25f, 1.25f,2.25f, -.75f,2.25f});
            quad.put(0,new float[]{-1,-1,-1.5f, 1,-1,-1.5f, -1,1,-3, 1,-1,-1.5f, 1,1,-3, -1,1,-3});
            s.glDrawArrays(GL_TRIANGLES,0,6);s.endDrawing();
            require(Arrays.hashCode(sp)==0x0e58c805 && Arrays.stream(sp).distinct().count()>1000,
                    "linear texture at huge coordinates with alpha test and fog draws as before");
            System.out.println("ALL OGL CHECKS PASSED");System.exit(0);
        }catch(Throwable e){e.printStackTrace();System.exit(1);}
    }
}
