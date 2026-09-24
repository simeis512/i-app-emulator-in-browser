// SPDX-License-Identifier: GPL-3.0-or-later
// Original 3D test fixture: every shape and colour is defined here; no recovered code, media or device assets.
// The same frame is drawn by the software and WebGL2 renderers and compared in tests/browser.cjs.
import com.nttdocomo.ui.*;
import com.nttdocomo.ui.ogl.*;

public class TestOgl extends IApplication {
    public void start() { Display.setCurrent(new Scene()); }
    static class Scene extends Canvas implements Runnable {
        final DirectBufferFactory buffers=DirectBufferFactory.getFactory();
        Scene() { new Thread(this).start(); }
        FloatBuffer floats(float... values) { return buffers.allocateFloatBuffer(values); }
        void shape(GraphicsOGL gl,int mode,int shade,float[] vertices,float[] colors) {
            gl.glShadeModel(shade);
            gl.glVertexPointer(3,GraphicsOGL.GL_FLOAT,0,floats(vertices));
            gl.glColorPointer(4,GraphicsOGL.GL_FLOAT,0,floats(colors));
            gl.glDrawArrays(mode,0,vertices.length/3);
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
            gl.glViewport(0,0,w,h);
            gl.endDrawing();
            // 2D over the 3D.
            g.setColor(Graphics.getColorOfRGB(255,220,0));g.fillRect(4,4,30,14);
            g.unlock(true);
        }
        public void run() {try{while(true){repaint();Thread.sleep(100);}}catch(Exception e){throw new RuntimeException(e);}}
    }
}
