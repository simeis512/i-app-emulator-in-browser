import java.util.Arrays;
import org.recompile.mobile.*;
import com.nttdocomo.ui.Graphics;
import com.nttdocomo.ui.ogl.*;
import opendoja.host.ogl.HostDirectBuffers.HostFloatBuffer;
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
            System.out.println("ALL OGL CHECKS PASSED");System.exit(0);
        }catch(Throwable e){e.printStackTrace();System.exit(1);}
    }
}
