import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.jar.*;
import javax.sound.midi.*;
import javax.microedition.media.*;
import com.nttdocomo.ui.*;
import com.nttdocomo.util.ScratchPadConnection;
import org.recompile.mobile.*;
import p905i.web.ClockPlayer;

public final class RuntimeChecks {
    static void require(boolean ok,String what){if(!ok)throw new AssertionError(what);System.out.println("PASS "+what);}
    public static void main(String[] args) throws Exception {
        try {
            byte[] jam="AppClass=Test\n\tIappli\nSPsize=4, 004\nAppName=日本語\n".getBytes("Shift_JIS");
            HashMap<String,String> descriptor=p905i.web.BrowserRuntime.readDescriptor(new ByteArrayInputStream(jam));
            require("TestIappli".equals(descriptor.get("AppClass")) && "4,4".equals(descriptor.get("SPsize")) &&
                "日本語".equals(descriptor.get("AppName")),"JAM folds tabs, decodes Shift_JIS and normalizes region sizes");
            boolean rejected=false;
            try { p905i.web.BrowserRuntime.readDescriptor(new ByteArrayInputStream("AppClass=Test\nSPsize=4,-1\n".getBytes("Shift_JIS"))); }
            catch(IOException expected){rejected=true;}
            require(rejected,"runtime rejects invalid region sizes before application startup");
            Path work=Files.createTempDirectory(Paths.get(args[0]),"checks-");
            Mobile.isDoJa=true;Mobile.DoJaVersion=51;Mobile.sound=false;Mobile.maskIndex=0;
            Mobile.minLogLevel=Mobile.LOG_NONE;
            MobilePlatform platform=new MobilePlatform(32,32);
            Mobile.setPlatform(platform,()->{});platform.dataPath=work.toString()+"/";
            Path jar=work.resolve("fixture.jar");new JarOutputStream(Files.newOutputStream(jar)).close();
            HashMap<String,String> props=new HashMap<>();props.put("AppName","fixture");props.put("AppClass","fixture");
            platform.loader=new MIDletLoader(jar.toUri().toURL(),props);
            IApplication.scratchPadSizes=new String[]{"4","4"};
            byte[] original={10,11,12,13,20,21,22,23};
            Path sp=work.resolve("fixture.sp");Files.write(sp,original);MobilePlatform.spFileName=sp.toUri().toString();
            ScratchPadConnection first=new ScratchPadConnection("scratchpad:///0");
            ScratchPadConnection second=new ScratchPadConnection("scratchpad:///1");
            require(Arrays.equals(first.loadScratchPadBinary(),new byte[]{10,11,12,13}),"raw scratchpad first region has no header shift");
            require(Arrays.equals(second.loadScratchPadBinary(),new byte[]{20,21,22,23}),"raw scratchpad second region has correct offset");
            InputStream read=second.openInputStream();require(read.available()==4,"scratchpad includes last byte");
            OutputStream write=new ScratchPadConnection("scratchpad:///1;pos=3,length=1").openOutputStream();
            write.write(77);write.write(88);write.close();write.close();
            read=new ScratchPadConnection("scratchpad:///1;pos=3").openInputStream();
            require(read.read()==77 && read.read()==-1,"bounded write and repeated close retain the last byte");
            require(Arrays.equals(Files.readAllBytes(sp),original),"recovered input save remains unchanged");
            byte[] header=new byte[72];System.arraycopy(original,0,header,64,8);Path idk=work.resolve("idk.sp");Files.write(idk,header);
            MobilePlatform.spFileName=idk.toUri().toString();
            require(Arrays.equals(second.loadScratchPadBinary(),new byte[]{20,21,22,23}),"iDK header is detected by exact total length");
            byte[] exported=java.util.Base64.getDecoder().decode(p905i.web.BrowserRuntime.exportScratchpad());
            require(exported.length==8 && exported[7]==77 && exported[0]==10,"SP export uses current records and strips the input header");
            require(PhoneSystem.getAttribute(PhoneSystem.DEV_MANNER)==0,"manner-mode attribute can be read");
            PhoneSystem.setAttribute(PhoneSystem.DEV_VIBRATOR,PhoneSystem.ATTR_VIBRATOR_ON);
            PhoneSystem.setAttribute(PhoneSystem.DEV_VIBRATOR,PhoneSystem.ATTR_VIBRATOR_OFF);
            String vibrationLog=p905i.web.BrowserRuntime.getLog();
            require(vibrationLog.indexOf("Application vibrator on")>=0 &&
                vibrationLog.indexOf("Application vibrator off")>vibrationLog.indexOf("Application vibrator on"),
                "both vibrator transitions reach the bridge without a repaint or browser native");
            // Loaded applications call yieldOverride for Thread.yield; only flushed frames are limited.
            Mobile.limitFPS=30;long yielding=System.nanoTime();for(int i=0;i<20;i++)MIDletEnhancements.yieldOverride();
            require(System.nanoTime()-yielding<200_000_000L,"Thread.yield hands over the CPU without waiting for a frame");
            long limited=System.nanoTime();platform.limitFps();platform.limitFps();
            require(System.nanoTime()-limited>=25_000_000L,"flushed frames are still held to the frame rate");

            PlatformImage source=new PlatformImage(2,2),target=new PlatformImage(4,4);
            Arrays.fill(source.getDataBuffer(),0xffff0000);
            target.getDoJaGraphics().drawTransformedImage(source,0,0,4,4,-1,-1,4,4,0);
            int painted=0;for(int pixel:target.getDataBuffer())if(pixel==0xffff0000)painted++;
            require(painted==4 && target.getDataBuffer()[5]==0xffff0000,"scaled source clipping preserves valid pixels");

            // DoJa clips follow setOrigin; only clearClip names the whole surface.
            PlatformImage clipped=new PlatformImage(40,40);com.nttdocomo.ui.Graphics clip=clipped.getDoJaGraphics();
            clip.setOrigin(20,20);clip.setClip(2,2,6,6);clip.setColor(com.nttdocomo.ui.Graphics.getColorOfRGB(0,255,0));
            clip.fillRect(-20,-20,80,80);
            int[] pixels=clipped.getDataBuffer();int green=pixels[24*40+24];
            require((green&0xffffff)==0x00ff00,"a clip set after setOrigin lies inside the moved origin");
            require(pixels[4*40+4]!=green && pixels[30*40+30]!=green,"nothing is drawn outside that clip");
            clip.clearClip();clip.fillRect(-20,-20,4,4);
            require(clipped.getDataBuffer()[1*40+1]==green,"clearClip opens the whole surface whatever the origin");

            // Applications size their text by asking for TINY to LARGE, so each must differ.
            com.nttdocomo.ui.Font tiny=com.nttdocomo.ui.Font.getFont(com.nttdocomo.ui.Font.SIZE_TINY);
            com.nttdocomo.ui.Font large=com.nttdocomo.ui.Font.getFont(com.nttdocomo.ui.Font.FACE_SYSTEM|
                com.nttdocomo.ui.Font.STYLE_PLAIN|com.nttdocomo.ui.Font.SIZE_LARGE);
            require(tiny.getHeight()<large.getHeight() && tiny.stringWidth("あいう")<large.stringWidth("あいう"),
                "a requested font size is honoured rather than replaced by the default");
            require(com.nttdocomo.ui.Font.getFont(com.nttdocomo.ui.Font.SIZE_TINY)==tiny,"a repeated request reuses the font");
            // Handsets drew bitmap text: every pixel is either the ink or what was underneath.
            PlatformImage text=new PlatformImage(80,24);com.nttdocomo.ui.Graphics ink=text.getDoJaGraphics();
            ink.setColor(com.nttdocomo.ui.Graphics.getColorOfRGB(0,0,0));ink.fillRect(0,0,80,24);
            ink.setColor(com.nttdocomo.ui.Graphics.getColorOfRGB(255,255,255));ink.setFont(large);ink.drawString("あ木Ag",2,20);
            int inked=0,blended=0;
            for(int pixel:text.getDataBuffer()){int value=pixel&0xffffff;if(value==0xffffff)inked++;else if(value!=0)blended++;}
            require(inked>0 && blended==0,"text is drawn without antialiasing, as on the handset");

            Sequence seq=new Sequence(Sequence.PPQ,100);Track track=seq.createTrack();
            ShortMessage note=new ShortMessage();note.setMessage(ShortMessage.NOTE_ON,0,21,100);track.add(new MidiEvent(note,10));
            MetaMessage end=new MetaMessage();end.setMessage(0x2f,new byte[0],0);track.add(new MidiEvent(end,30));
            ByteArrayOutputStream midi=new ByteArrayOutputStream();MidiSystem.write(seq,1,midi);
            PlatformPlayer player=new PlatformPlayer(new ByteArrayInputStream(midi.toByteArray()),"audio/midi");
            player.prefetch();require(player.getState()==Player.PREFETCHED,"muted media realizes and prefetches");
            CountDownLatch sync=new CountDownLatch(1),complete=new CountDownLatch(1);
            MediaListener listener=(p,event,value)->{if(event==AudioPresenter.AUDIO_SYNC)sync.countDown();if(event==AudioPresenter.AUDIO_COMPLETE)complete.countDown();};
            player.setDoJaListener(listener,null);ClockPlayer.configure(player,listener,null,0,21);
            player.start();require(sync.await(3,TimeUnit.SECONDS),"muted sequence emits note synchronization");
            require(complete.await(3,TimeUnit.SECONDS),"muted sequence emits completion at its actual duration");
            require(player.getState()==Player.PREFETCHED,"completed sequence returns to prefetched state");
            player.close();
            System.out.println("ALL RUNTIME CHECKS PASSED");System.exit(0);
        } catch(Throwable e){e.printStackTrace();System.exit(1);}
    }
}
