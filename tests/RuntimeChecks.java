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

            PlatformImage source=new PlatformImage(2,2),target=new PlatformImage(4,4);
            Arrays.fill(source.getDataBuffer(),0xffff0000);
            target.getDoJaGraphics().drawTransformedImage(source,0,0,4,4,-1,-1,4,4,0);
            int painted=0;for(int pixel:target.getDataBuffer())if(pixel==0xffff0000)painted++;
            require(painted==4 && target.getDataBuffer()[5]==0xffff0000,"scaled source clipping preserves valid pixels");

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
