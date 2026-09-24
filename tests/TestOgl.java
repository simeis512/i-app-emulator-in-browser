// SPDX-License-Identifier: GPL-3.0-or-later
// Original 3D test fixture: every shape and colour is defined here; no recovered code, media or device assets.
// The same frames are drawn by the software and WebGL2 renderers and compared in tests/browser.cjs.
// Keys 1 to 3 choose the scene: 1 colours, shading, clipping and viewports; 2 depth; 3 textures.
import com.nttdocomo.ui.*;
import com.nttdocomo.ui.ogl.*;

public class TestOgl extends IApplication {
    public void start() { Display.setCurrent(new Scene()); }
    static class Scene extends Canvas implements Runnable {
        final DirectBufferFactory buffers=DirectBufferFactory.getFactory();
        volatile int scene=1;
        Scene() { new Thread(this).start(); }
        public void processEvent(int type,int key) {
            if(type==Display.KEY_PRESSED_EVENT && key>=Display.KEY_1 && key<=Display.KEY_3)scene=key-Display.KEY_0;
        }
        FloatBuffer floats(float... values) { return buffers.allocateFloatBuffer(values); }
        void shape(GraphicsOGL gl,int mode,int shade,float[] vertices,float[] colors) {
            gl.glShadeModel(shade);
            gl.glVertexPointer(3,GraphicsOGL.GL_FLOAT,0,floats(vertices));
            gl.glColorPointer(4,GraphicsOGL.GL_FLOAT,0,floats(colors));
            gl.glDrawArrays(mode,0,vertices.length/3);
        }
        /** An axis-aligned quad at one eye depth, in one colour. */
        void quad(GraphicsOGL gl,float x0,float y0,float x1,float y1,float z,float r,float g,float b) {
            shape(gl,GraphicsOGL.GL_TRIANGLE_STRIP,GraphicsOGL.GL_SMOOTH,new float[]{x0,y0,z, x1,y0,z, x0,y1,z, x1,y1,z},
                new float[]{r,g,b,1, r,g,b,1, r,g,b,1, r,g,b,1});
        }
        public void paint(Graphics g) {
            GraphicsOGL gl=(GraphicsOGL)g;int w=getWidth(),h=getHeight();
            g.lock();
            // A 2D background that 3D must keep wherever it draws nothing.
            g.setColor(Graphics.getColorOfRGB(20,40,90));g.fillRect(0,0,w,h);
            g.setColor(Graphics.getColorOfRGB(200,200,200));g.fillRect(0,h-40,w,40);
            gl.beginDrawing();
            gl.glViewport(0,0,w,h);
            gl.glMatrixMode(GraphicsOGL.GL_PROJECTION);gl.glLoadIdentity();gl.glOrthof(-1,1,-1,1,-1,1);
            gl.glMatrixMode(GraphicsOGL.GL_MODELVIEW);gl.glLoadIdentity();
            gl.glDisable(GraphicsOGL.GL_TEXTURE_2D);gl.glDisable(GraphicsOGL.GL_DEPTH_TEST);gl.glDisable(GraphicsOGL.GL_CULL_FACE);
            gl.glEnableClientState(GraphicsOGL.GL_VERTEX_ARRAY);gl.glEnableClientState(GraphicsOGL.GL_COLOR_ARRAY);
            if(scene==2)depth(gl,w,h);else if(scene==3)textures(gl,w,h);else colours(gl,w,h);
            gl.glViewport(0,0,w,h);
            gl.endDrawing();
            // 2D over the 3D.
            g.setColor(Graphics.getColorOfRGB(255,220,0));g.fillRect(4,4,30,14);
            g.unlock(true);
        }
        void colours(GraphicsOGL gl,int w,int h) {
            // Top left: colours blend across a smooth triangle.
            shape(gl,GraphicsOGL.GL_TRIANGLES,GraphicsOGL.GL_SMOOTH,new float[]{-.9f,.1f,0, -.1f,.1f,0, -.5f,.9f,0},
                new float[]{1,0,0,1, 0,1,0,1, 0,0,1,1});
            // Top right: a flat strip, each triangle in its last vertex's colour.
            shape(gl,GraphicsOGL.GL_TRIANGLE_STRIP,GraphicsOGL.GL_FLAT,new float[]{.1f,.1f,0, .9f,.1f,0, .1f,.9f,0, .9f,.9f,0},
                new float[]{1,1,0,1, 1,0,1,1, 0,1,1,1, 1,.5f,0,1});
            // Bottom left: a triangle past the left and bottom edges, so it is clipped first.
            shape(gl,GraphicsOGL.GL_TRIANGLES,GraphicsOGL.GL_SMOOTH,new float[]{-1.6f,-1.5f,0, -.1f,-.2f,0, -.8f,-.05f,0},
                new float[]{1,1,1,1, .5f,.5f,.5f,1, 1,.3f,.3f,1});
            // A small viewport above the bar, like a rear-view mirror.
            gl.glViewport(w/2+10,50,w/2-20,50);
            shape(gl,GraphicsOGL.GL_TRIANGLES,GraphicsOGL.GL_SMOOTH,new float[]{-1,-1,0, 1,-1,0, 0,1,0},
                new float[]{0,.8f,.4f,1, 0,.4f,.8f,1, .9f,.9f,.9f,1});
        }
        void depth(GraphicsOGL gl,int w,int h) {
            gl.glEnable(GraphicsOGL.GL_DEPTH_TEST);gl.glDepthFunc(GraphicsOGL.GL_LESS);gl.glDepthMask(true);
            // Eye z 0.5 is nearer than -0.5 under this projection.
            quad(gl,-.8f,.2f,-.2f,.8f,.5f, 0,.8f,.2f);           // near, green
            quad(gl,-.5f,0,.1f,.5f,-.5f, .8f,0,.8f);             // far, magenta: hidden where the green is
            quad(gl,-.7f,.3f,-.5f,.6f,.5f, 1,1,1);               // equal depth: LESS keeps the green
            gl.glDepthFunc(GraphicsOGL.GL_LEQUAL);
            quad(gl,-.4f,.3f,-.3f,.6f,.5f, 1,.9f,0);             // equal depth: LEQUAL draws the yellow
            gl.glDepthFunc(GraphicsOGL.GL_LESS);gl.glDepthMask(false);
            quad(gl,.2f,.2f,.6f,.6f,.8f, 0,.9f,.9f);             // nearest cyan, but it writes no depth...
            gl.glDepthMask(true);
            quad(gl,.3f,.3f,.8f,.8f,-.2f, 1,.5f,0);              // ...so a farther orange covers it
            quad(gl,-.8f,-.8f,-.2f,-.2f,.9f, 0,0,1);             // near blue
            gl.glClear(GraphicsOGL.GL_DEPTH_BUFFER_BIT);
            quad(gl,-.5f,-.5f,.1f,.1f,-.9f, 1,0,0);              // after the clear, a far red covers the blue
            // A small viewport cleared on its own, as a rear-view mirror is; the clear resets all depth.
            gl.glViewport(w/2+10,20,w/2-30,60);
            gl.glClear(GraphicsOGL.GL_DEPTH_BUFFER_BIT);
            shape(gl,GraphicsOGL.GL_TRIANGLES,GraphicsOGL.GL_SMOOTH,new float[]{-1,-1,.5f, 1,-1,.5f, 0,1,.5f},
                new float[]{0,.7f,.3f,1, 0,.7f,.3f,1, 0,.7f,.3f,1});
            gl.glDisable(GraphicsOGL.GL_DEPTH_TEST);
        }
        int[] names;
        /** Original textures: an RGBA checker with clear and half-clear texels, an RGB ramp, luminance, alpha, and
         * luminance with alpha. */
        void makeTextures(GraphicsOGL gl) {
            names=new int[5];gl.glGenTextures(5,names);
            byte[] checker=new byte[4*4*4];
            for(int i=0;i<16;i++){boolean dark=((i^(i>>2))&1)==0;checker[i*4]=(byte)(dark?40:230);checker[i*4+1]=(byte)(i*16);
                checker[i*4+2]=(byte)(dark?200:30);checker[i*4+3]=(byte)(i==5?0:i==10?128:255);}
            byte[] ramp=new byte[8*2*3];for(int i=0;i<16;i++){ramp[i*3]=(byte)(i*16);ramp[i*3+1]=(byte)(255-i*16);ramp[i*3+2]=(byte)(i<8?60:180);}
            byte[] luminance=new byte[16];for(int i=0;i<16;i++)luminance[i]=(byte)(i*17);
            byte[] alpha=new byte[16];for(int i=0;i<16;i++)alpha[i]=(byte)(255-i*16);
            byte[] both={(byte)250,(byte)255,(byte)120,(byte)200,(byte)60,(byte)90,(byte)10,(byte)255};
            Object[][] data={{checker,4,4,GraphicsOGL.GL_RGBA},{ramp,8,2,GraphicsOGL.GL_RGB},{luminance,4,4,GraphicsOGL.GL_LUMINANCE},
                {alpha,4,4,GraphicsOGL.GL_ALPHA},{both,2,2,GraphicsOGL.GL_LUMINANCE_ALPHA}};
            for(int i=0;i<5;i++){
                gl.glBindTexture(GraphicsOGL.GL_TEXTURE_2D,names[i]);int format=(Integer)data[i][3];
                gl.glTexImage2D(GraphicsOGL.GL_TEXTURE_2D,0,format,(Integer)data[i][1],(Integer)data[i][2],0,format,
                    GraphicsOGL.GL_UNSIGNED_BYTE,buffers.allocateByteBuffer((byte[])data[i][0]));
            }
        }
        void textured(GraphicsOGL gl,int texture,int filter,int wrap,int function,float x0,float y0,float x1,float y1,float u0,float u1) {
            gl.glBindTexture(GraphicsOGL.GL_TEXTURE_2D,names[texture]);
            gl.glTexParameteri(GraphicsOGL.GL_TEXTURE_2D,GraphicsOGL.GL_TEXTURE_MIN_FILTER,filter);
            gl.glTexParameteri(GraphicsOGL.GL_TEXTURE_2D,GraphicsOGL.GL_TEXTURE_MAG_FILTER,filter);
            gl.glTexParameteri(GraphicsOGL.GL_TEXTURE_2D,GraphicsOGL.GL_TEXTURE_WRAP_S,wrap);
            gl.glTexParameteri(GraphicsOGL.GL_TEXTURE_2D,GraphicsOGL.GL_TEXTURE_WRAP_T,wrap);
            gl.glTexEnvi(GraphicsOGL.GL_TEXTURE_ENV,GraphicsOGL.GL_TEXTURE_ENV_MODE,function);
            gl.glTexCoordPointer(2,GraphicsOGL.GL_FLOAT,0,floats(u0,u0, u1,u0, u0,u1, u1,u1));
            shape(gl,GraphicsOGL.GL_TRIANGLE_STRIP,GraphicsOGL.GL_SMOOTH,new float[]{x0,y0,0, x1,y0,0, x0,y1,0, x1,y1,0},
                new float[]{1,1,1,1, 1,.6f,.6f,1, .6f,.6f,1,.8f, .9f,1,.5f,1});
        }
        void textures(GraphicsOGL gl,int w,int h) {
            if(names==null)makeTextures(gl);
            gl.glEnable(GraphicsOGL.GL_TEXTURE_2D);gl.glEnableClientState(GraphicsOGL.GL_TEXTURE_COORD_ARRAY);
            gl.glTexEnvfv(GraphicsOGL.GL_TEXTURE_ENV,GraphicsOGL.GL_TEXTURE_ENV_COLOR,new float[]{.2f,.9f,.4f,1});
            int nearest=GraphicsOGL.GL_NEAREST,linear=GraphicsOGL.GL_LINEAR,repeat=GraphicsOGL.GL_REPEAT,edge=GraphicsOGL.GL_CLAMP_TO_EDGE;
            // Top row: the RGBA checker repeated, nearest and linear; the RGB ramp clamped and replaced; the checker as a decal.
            textured(gl,0,nearest,repeat,GraphicsOGL.GL_MODULATE,-.95f,.1f,-.55f,.9f,-1.25f,2.75f);
            textured(gl,0,linear,repeat,GraphicsOGL.GL_MODULATE,-.45f,.1f,-.05f,.9f,-1.25f,2.75f);
            textured(gl,1,linear,edge,GraphicsOGL.GL_REPLACE,.05f,.1f,.45f,.9f,-.5f,1.5f);
            textured(gl,0,nearest,repeat,GraphicsOGL.GL_DECAL,.55f,.1f,.95f,.9f,0,2);
            // Bottom row: luminance blended with the texture colour, alpha added, luminance with alpha modulated.
            textured(gl,2,nearest,repeat,GraphicsOGL.GL_BLEND,-.95f,-.8f,-.55f,-.1f,0,1);
            textured(gl,3,nearest,repeat,GraphicsOGL.GL_ADD,-.45f,-.8f,-.05f,-.1f,0,1);
            textured(gl,4,linear,repeat,GraphicsOGL.GL_MODULATE,.05f,-.8f,.45f,-.1f,-.5f,1.5f);
            // A quad receding in perspective, so texture coordinates are interpolated perspective-correctly.
            gl.glMatrixMode(GraphicsOGL.GL_PROJECTION);gl.glLoadIdentity();gl.glFrustumf(-.1f,.1f,-.1f,.1f,.1f,10);
            gl.glMatrixMode(GraphicsOGL.GL_MODELVIEW);gl.glLoadIdentity();
            gl.glBindTexture(GraphicsOGL.GL_TEXTURE_2D,names[0]);
            gl.glTexParameteri(GraphicsOGL.GL_TEXTURE_2D,GraphicsOGL.GL_TEXTURE_MIN_FILTER,nearest);
            gl.glTexParameteri(GraphicsOGL.GL_TEXTURE_2D,GraphicsOGL.GL_TEXTURE_MAG_FILTER,nearest);
            gl.glTexParameteri(GraphicsOGL.GL_TEXTURE_2D,GraphicsOGL.GL_TEXTURE_WRAP_S,repeat);
            gl.glTexParameteri(GraphicsOGL.GL_TEXTURE_2D,GraphicsOGL.GL_TEXTURE_WRAP_T,repeat);
            gl.glTexEnvi(GraphicsOGL.GL_TEXTURE_ENV,GraphicsOGL.GL_TEXTURE_ENV_MODE,GraphicsOGL.GL_REPLACE);
            gl.glTexCoordPointer(2,GraphicsOGL.GL_FLOAT,0,floats(0,0, 3,0, 0,6, 3,6));
            shape(gl,GraphicsOGL.GL_TRIANGLE_STRIP,GraphicsOGL.GL_SMOOTH,new float[]{.06f,-.09f,-.12f, .09f,-.09f,-.12f, .065f,-.02f,-.6f, .085f,-.02f,-.6f},
                new float[]{1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1});
            gl.glDisable(GraphicsOGL.GL_TEXTURE_2D);gl.glDisableClientState(GraphicsOGL.GL_TEXTURE_COORD_ARRAY);
        }
        public void run() {try{while(true){repaint();Thread.sleep(100);}}catch(Exception e){throw new RuntimeException(e);}}
    }
}
