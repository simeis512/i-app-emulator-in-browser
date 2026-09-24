// SPDX-License-Identifier: GPL-3.0-or-later
// Original 3D test fixture: every shape and colour is defined here; no recovered code, media or device assets.
// The same frames are drawn by the software and WebGL2 renderers and compared in tests/browser.cjs.
// Keys 1 and 2 choose the scene: 1 colours, shading, clipping and viewports; 2 depth.
import com.nttdocomo.ui.*;
import com.nttdocomo.ui.ogl.*;

public class TestOgl extends IApplication {
    public void start() { Display.setCurrent(new Scene()); }
    static class Scene extends Canvas implements Runnable {
        final DirectBufferFactory buffers=DirectBufferFactory.getFactory();
        volatile int scene=1;
        Scene() { new Thread(this).start(); }
        public void processEvent(int type,int key) {
            if(type==Display.KEY_PRESSED_EVENT && key>=Display.KEY_1 && key<=Display.KEY_2)scene=key-Display.KEY_0;
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
            if(scene==2)depth(gl,w,h);else colours(gl,w,h);
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
        public void run() {try{while(true){repaint();Thread.sleep(100);}}catch(Exception e){throw new RuntimeException(e);}}
    }
}
