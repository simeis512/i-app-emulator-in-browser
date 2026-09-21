// SPDX-License-Identifier: GPL-3.0-or-later
// Original test fixture: no recovered code, media or device assets.
import com.nttdocomo.ui.*;
import javax.microedition.io.Connector;
import java.io.*;

public class TestIappli extends IApplication {
    public void start() { Display.setCurrent(new TestCanvas()); }
    static class TestCanvas extends Canvas implements Runnable {
        int x=16, frames;
        AudioPresenter music, effect;
        TestCanvas() {
            try(DataInputStream in=Connector.openDataInputStream("scratchpad:///0")) {
                x=in.readInt();if(x<8 || x>200)x=16;
            }catch(Exception ignored){}
            try {
                MediaSound melody=MediaManager.getSound("resource:///fixture.mid");melody.use();
                music=AudioPresenter.getAudioPresenter(0);music.setSound(melody);
                music.setAttribute(AudioPresenter.LOOP_COUNT,-1);music.play();
                MediaSound pcm=MediaManager.getSound("resource:///fixture.wav");pcm.use();
                effect=AudioPresenter.getAudioPresenter(1);effect.setSound(pcm);
            }catch(Exception e){throw new RuntimeException(e);}
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
            if(key==Display.KEY_1)effect.play();
            if(key==Display.KEY_3)music.setAttribute(AudioPresenter.SET_VOLUME,0);
            if(key==Display.KEY_4)music.setAttribute(AudioPresenter.SET_VOLUME,100);
            if(key==Display.KEY_5)music.pause();
            if(key==Display.KEY_6)music.restart();
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
