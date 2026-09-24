import java.util.Arrays;
import org.recompile.mobile.*;
import com.nttdocomo.ui.Graphics;
import com.nttdocomo.ui.ogl.*;
import opendoja.host.ogl.HostDirectBuffers.HostByteBuffer;
import opendoja.host.ogl.HostDirectBuffers.HostFloatBuffer;
import opendoja.host.ogl.HostDirectBuffers.HostShortBuffer;
import p905i.web.ExactMath;
import static com.nttdocomo.ui.ogl.GraphicsOGL.*;

/** Pixel-level integration checks against the compiled bridge and renderer. */
public final class OglChecks {
    static int pick(java.util.Random r,int... values){return values[r.nextInt(values.length)];}
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

            // Random scenes across the states the pixel loop handles separately: texture formats, filters, wraps and
            // functions, blend factors, depth and alpha functions, fog, flat shading, culling, lighting and clipping.
            // The checksum was taken from the renderer before its pixel loop was rewritten.
            PlatformImage field=new PlatformImage(96,72);Graphics q=field.getDoJaGraphics();int[] fp=field.getDataBuffer();
            int[] names=new int[5];int[][] formats={{GL_RGB,3},{GL_RGBA,4},{GL_LUMINANCE,1},{GL_LUMINANCE_ALPHA,2},{GL_ALPHA,1}};
            java.util.Random tr=new java.util.Random(11);q.beginDrawing();q.glGenTextures(5,names);
            for(int t=0;t<5;t++){
                int n=4<<(t%3),b=formats[t][1];byte[] data=new byte[n*n*b];tr.nextBytes(data);
                for(int i=b-1;b%2==0&&i<data.length;i+=b*5)data[i]=0;
                q.glBindTexture(GL_TEXTURE_2D,names[t]);q.glTexImage2D(GL_TEXTURE_2D,0,formats[t][0],n,n,0,formats[t][0],GL_UNSIGNED_BYTE,new HostByteBuffer(data));
            }
            q.endDrawing();
            int combined=0,drawn=0;
            for(int seed=0;seed<300;seed++){
                java.util.Random r=new java.util.Random(seed);
                q.clearClip();if(r.nextInt(5)==0)q.setClip(r.nextInt(30),r.nextInt(20),20+r.nextInt(60),20+r.nextInt(40));
                q.beginDrawing();q.glViewport(0,0,96,72);if(r.nextInt(6)==0)q.glViewport(r.nextInt(20),r.nextInt(15),40+r.nextInt(50),30+r.nextInt(40));
                q.glClearColor(r.nextFloat(),r.nextFloat(),r.nextFloat(),1);q.glClear(GL_COLOR_BUFFER_BIT|GL_DEPTH_BUFFER_BIT);
                boolean persp=r.nextBoolean();q.glMatrixMode(GL_PROJECTION);q.glLoadIdentity();
                if(persp)q.glFrustumf(-1,1,-.75f,.75f,1,20);else q.glOrthof(-2,2,-1.5f,1.5f,-10,10);
                q.glMatrixMode(GL_MODELVIEW);q.glLoadIdentity();
                if(r.nextInt(5)!=0){q.glEnable(GL_TEXTURE_2D);q.glBindTexture(GL_TEXTURE_2D,names[r.nextInt(5)]);}else q.glDisable(GL_TEXTURE_2D);
                q.glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,pick(r,GL_NEAREST,GL_LINEAR));q.glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,pick(r,GL_NEAREST,GL_LINEAR));
                q.glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_WRAP_S,pick(r,GL_REPEAT,GL_CLAMP_TO_EDGE));q.glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_WRAP_T,pick(r,GL_REPEAT,GL_CLAMP_TO_EDGE));
                q.glTexEnvi(GL_TEXTURE_ENV,GL_TEXTURE_ENV_MODE,pick(r,GL_MODULATE,GL_MODULATE,GL_REPLACE,GL_DECAL,GL_BLEND,GL_ADD));
                q.glTexEnvfv(GL_TEXTURE_ENV,GL_TEXTURE_ENV_COLOR,new float[]{r.nextFloat(),r.nextFloat(),r.nextFloat(),r.nextFloat()});
                if(r.nextInt(5)<2){q.glEnable(GL_BLEND);int[][] pairs={{GL_SRC_ALPHA,GL_ONE_MINUS_SRC_ALPHA},{GL_ONE,GL_ONE},{GL_ZERO,GL_SRC_COLOR},{GL_DST_COLOR,GL_ZERO},
                    {GL_ONE,GL_ONE_MINUS_SRC_ALPHA},{GL_SRC_ALPHA,GL_ONE},{GL_ONE_MINUS_DST_COLOR,GL_ONE},{GL_ONE,GL_ZERO}};int[] p=pairs[r.nextInt(pairs.length)];q.glBlendFunc(p[0],p[1]);}
                else q.glDisable(GL_BLEND);
                if(r.nextInt(5)<3){q.glEnable(GL_DEPTH_TEST);q.glDepthFunc(r.nextInt(10)<6?GL_LESS:r.nextInt(3)==0?GL_LEQUAL:r.nextInt(2)==0?GL_ALWAYS:GL_NEVER+r.nextInt(8));}
                else q.glDisable(GL_DEPTH_TEST);
                q.glDepthMask(r.nextInt(4)!=0);
                if(r.nextInt(5)<2){q.glEnable(GL_ALPHA_TEST);q.glAlphaFunc(r.nextInt(10)<5?GL_NOTEQUAL:r.nextInt(2)==0?GL_GREATER:GL_NEVER+r.nextInt(8),r.nextInt(3)==0?0:r.nextFloat()*.6f);}
                else q.glDisable(GL_ALPHA_TEST);
                if(r.nextInt(10)<3){q.glEnable(GL_FOG);q.glFogf(GL_FOG_MODE,pick(r,GL_LINEAR,GL_EXP,GL_EXP2));q.glFogf(GL_FOG_START,3*r.nextFloat());q.glFogf(GL_FOG_END,3+12*r.nextFloat());
                    q.glFogf(GL_FOG_DENSITY,.5f*r.nextFloat());q.glFogfv(GL_FOG_COLOR,new float[]{r.nextFloat(),r.nextFloat(),r.nextFloat(),1});}
                else q.glDisable(GL_FOG);
                q.glShadeModel(r.nextInt(4)==0?GL_FLAT:GL_SMOOTH);
                if(r.nextInt(10)<3){q.glEnable(GL_CULL_FACE);q.glCullFace(pick(r,GL_FRONT,GL_BACK,GL_BACK));}else q.glDisable(GL_CULL_FACE);
                q.glFrontFace(r.nextBoolean()?GL_CCW:GL_CW);
                boolean light=r.nextInt(5)==0;
                if(light){q.glEnable(GL_LIGHTING);q.glEnable(GL_LIGHT0);q.glLightfv(GL_LIGHT0,GL_POSITION,new float[]{2*r.nextFloat()-1,2*r.nextFloat()-1,1,0});
                    q.glLightfv(GL_LIGHT0,GL_DIFFUSE,new float[]{1,.9f,.8f,1});q.glLightModelf(GL_LIGHT_MODEL_TWO_SIDE,r.nextBoolean()?1:0);
                    if(r.nextBoolean())q.glEnable(GL_COLOR_MATERIAL);else{q.glDisable(GL_COLOR_MATERIAL);q.glMaterialfv(GL_FRONT_AND_BACK,GL_AMBIENT_AND_DIFFUSE,new float[]{r.nextFloat(),r.nextFloat(),r.nextFloat(),r.nextFloat()});}}
                else q.glDisable(GL_LIGHTING);
                for(int batch=0;batch<3;batch++){
                    int n=3*(2+r.nextInt(10));float[] v=new float[n*3],t=new float[n*2],c=new float[n*4],nm=new float[n*3];
                    float spread=r.nextInt(4)==0?4f:1.6f,tspread=r.nextInt(5)==0?1e5f:r.nextInt(3)==0?20f:3f;
                    for(int i=0;i<n;i++){
                        v[i*3]=spread*(2*r.nextFloat()-1);v[i*3+1]=.75f*spread*(2*r.nextFloat()-1);v[i*3+2]=persp?-1.2f-10.8f*r.nextFloat():10*r.nextFloat()-5;
                        t[i*2]=tspread*(2*r.nextFloat()-1);t[i*2+1]=tspread*(2*r.nextFloat()-1);
                        for(int k=0;k<4;k++)c[i*4+k]=r.nextInt(6)==0?1f:r.nextFloat();
                        for(int k=0;k<3;k++)nm[i*3+k]=2*r.nextFloat()-1;
                    }
                    if(r.nextInt(3)==0)for(int i=1;i<n;i++)System.arraycopy(c,0,c,i*4,4);
                    q.glEnableClientState(GL_VERTEX_ARRAY);q.glVertexPointer(3,GL_FLOAT,0,new HostFloatBuffer(v));
                    q.glEnableClientState(GL_TEXTURE_COORD_ARRAY);q.glTexCoordPointer(2,GL_FLOAT,0,new HostFloatBuffer(t));
                    if(r.nextInt(4)!=0){q.glEnableClientState(GL_COLOR_ARRAY);q.glColorPointer(4,GL_FLOAT,0,new HostFloatBuffer(c));}
                    else{q.glDisableClientState(GL_COLOR_ARRAY);q.glColor4f(r.nextFloat(),r.nextFloat(),r.nextFloat(),r.nextFloat());}
                    if(light){q.glEnableClientState(GL_NORMAL_ARRAY);q.glNormalPointer(GL_FLOAT,0,new HostFloatBuffer(nm));}else q.glDisableClientState(GL_NORMAL_ARRAY);
                    int mode=r.nextInt(3)==0?GL_TRIANGLE_STRIP:GL_TRIANGLES;
                    if(r.nextBoolean())q.glDrawArrays(mode,0,n);
                    else{short[] idx=new short[n];for(int i=0;i<n;i++)idx[i]=(short)r.nextInt(n);q.glDrawElements(mode,n,GL_UNSIGNED_SHORT,new HostShortBuffer(idx));}
                }
                q.endDrawing();
                combined=combined*31+Arrays.hashCode(fp);if(Arrays.stream(fp).distinct().count()>2)drawn++;
            }
            require(combined==0xc545e85c && drawn>270,"300 random scenes draw exactly as before the pixel loop was rewritten");
            System.out.println("ALL OGL CHECKS PASSED");System.exit(0);
        }catch(Throwable e){e.printStackTrace();System.exit(1);}
    }
}
