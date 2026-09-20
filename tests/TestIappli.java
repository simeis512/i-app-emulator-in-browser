// SPDX-License-Identifier: GPL-3.0-or-later
// Original test fixture: no recovered code, media or device assets.
import com.nttdocomo.ui.*;
import javax.microedition.io.Connector;
import java.io.*;

public class TestIappli extends IApplication {
    public void start() { Display.setCurrent(new TestCanvas()); }
    static class TestCanvas extends Canvas implements Runnable {
        int x=16, frames;
        TestCanvas() {
            try(DataInputStream in=Connector.openDataInputStream("scratchpad:///0")) {
                x=in.readInt();if(x<8 || x>200)x=16;
            }catch(Exception ignored){}
            save();new Thread(this).start();
        }
        void save() {
            try(DataOutputStream out=Connector.openDataOutputStream("scratchpad:///0;pos=0,length=4")){out.writeInt(x);}
            catch(Exception e){throw new RuntimeException(e);}
        }
        public void processEvent(int type,int key) {
            if(type!=Display.KEY_PRESSED_EVENT)return;
            if(key==Display.KEY_RIGHT)x=Math.min(200,x+20);
            if(key==Display.KEY_LEFT)x=Math.max(8,x-20);
            save();
        }
        public void paint(Graphics g) {
            g.lock();g.setColor(Graphics.getColorOfRGB(17,34,51));g.fillRect(0,0,getWidth(),getHeight());
            g.setColor(Graphics.getColorOfRGB(120,210,255));g.fillRect(x,90,20,20);
            g.setColor(Graphics.getColorOfRGB(255,255,255));g.drawString("Original test fixture",12,30);
            g.drawString("x="+x+" frame="+frames,12,52);g.unlock(true);
        }
        public void run() {try{while(true){frames++;repaint();Thread.sleep(100);}}catch(Exception e){throw new RuntimeException(e);}}
    }
}
