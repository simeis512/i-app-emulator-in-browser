// SPDX-License-Identifier: GPL-3.0-or-later
import java.io.*;
import java.nio.*;
import java.util.*;
import java.util.concurrent.*;
import javax.sound.midi.*;
import javax.microedition.media.*;
import javax.microedition.media.decoders.MLDDecoder;
import org.recompile.mobile.*;
import p905i.web.ClockPlayer;
import p905i.web.MldPcm;
import com.nttdocomo.ui.*;

public class AudioChecks {
    // Authored ADPCM codes, not a recording or device/game asset.
    static byte[] adat(int rate,int bits,int mode,boolean extraHeader)throws Exception{
        ByteArrayOutputStream bytes=new ByteArrayOutputStream();DataOutputStream out=new DataOutputStream(bytes);
        out.writeShort(extraHeader?19:11);out.writeByte(0x81);out.writeByte(0);
        if(extraHeader){out.writeBytes("test");out.writeShort(2);out.writeShort(0);}
        out.writeBytes("adpm");out.writeShort(3);out.writeByte(rate);out.writeByte(bits);out.writeByte(mode);
        for(int i=0;i<64;i++)out.writeByte((i*37+19)&255);
        return bytes.toByteArray();
    }
    static byte[] resourceMld(byte[]... resources)throws Exception{
        ByteArrayOutputStream body=new ByteArrayOutputStream();DataOutputStream out=new DataOutputStream(body);
        out.writeShort(11);out.write(new byte[]{1,1,1});out.writeBytes("ainf");out.writeShort(2);
        out.writeByte(resources.length);out.writeByte(0);
        for(byte[] resource:resources){out.writeBytes("adat");out.writeInt(resource.length);out.write(resource);}
        byte[] track={0,0x7f,(byte)0x80,0x7f,96,(byte)0xff,(byte)0xdf,0};
        out.writeBytes("trac");out.writeInt(track.length);out.write(track);
        ByteArrayOutputStream file=new ByteArrayOutputStream();out=new DataOutputStream(file);
        out.writeBytes("melo");out.writeInt(body.size());out.write(body.toByteArray());return file.toByteArray();
    }
    static void adpcmChecks()throws Exception{
        byte[] body=adat(16,2,1,false),wave=MldPcm.decodeAdat(body,0,body.length);
        ByteBuffer pcm=ByteBuffer.wrap(wave).order(ByteOrder.LITTLE_ENDIAN);
        require(pcm.getInt(24)==32000&&pcm.getShort(22)==1&&pcm.getShort(34)==16&&wave.length==1068,
                "16 kHz 2-bit ADPCM produces 32 kHz mono 16-bit PCM");
        require(ClockPlayer.waveDuration(wave)==16000,"2-bit upsampling preserves source duration");
        int energy=0;for(int i=44;i<wave.length;i+=2)energy+=Math.abs((int)pcm.getShort(i));
        require(energy>10000,"2-bit decoder produces a non-silent signal at PCM scale");
        byte[] padded=adat(16,2,1,true);
        require(Arrays.equals(wave,MldPcm.decodeAdat(padded,0,padded.length)),"ADAT subchunks do not leak into the audio payload");
        body=adat(8,2,1,false);wave=MldPcm.decodeAdat(body,0,body.length);
        require(wave.length==2092&&ClockPlayer.waveDuration(wave)==32000,"8 kHz 2-bit decoding preserves duration");
        body=adat(16,4,1,false);wave=MldPcm.decodeAdat(body,0,body.length);
        require(wave.length==556&&ClockPlayer.waveDuration(wave)==8000,"native 4-bit ADPCM also preserves source duration");
        body[2]=(byte)0x82;wave=MldPcm.decodeAdat(body,0,body.length);
        require(wave!=null&&Math.abs(ClockPlayer.waveDuration(wave)-8000)<100,"legacy 4-bit fallback remains decodable");
        body=adat(16,16,1,false);body[2]=(byte)0x80;wave=MldPcm.decodeAdat(body,0,body.length);
        require(ClockPlayer.waveDuration(wave)==2000&&Arrays.equals(Arrays.copyOfRange(wave,44,wave.length),Arrays.copyOfRange(body,13,body.length)),
                "MLD PCM16 preserves little-endian samples");
        for(byte[] unsupported:new byte[][]{adat(16,3,1,false),adat(16,2,2,false),adat(16,2,9,false),adat(32,2,1,false)})
            require(MldPcm.decodeAdat(unsupported,0,unsupported.length)==null,"unsupported ADPCM format leaves an empty resource slot");
        boolean rejected=false;try{MldPcm.decodeAdat(new byte[]{0,11,(byte)0x81,0},0,4);}catch(IllegalArgumentException expected){rejected=true;}
        require(rejected,"truncated ADAT header rejected before decoding");
        byte[] mld=resourceMld(adat(16,3,1,false),adat(16,2,1,false));
        MLDDecoder.decodeMLD(mld);
        require(MLDDecoder.pcmData.size()==2&&MLDDecoder.pcmData.get(0)==null&&MLDDecoder.pcmData.get(1).read()=='R',
                "MLD parser retains resource indices after an unsupported sample");
        ClockPlayer clock=new ClockPlayer(new ByteArrayInputStream(mld));
        require(timeOf(clock.getAudioEvents(),256,1)==0&&clock.getDuration()>0,"MLD resource trigger reaches the shared audio timeline");
    }
    static void require(boolean ok,String message){if(!ok)throw new AssertionError(message);System.out.println("PASS "+message);}
    static byte[] bytes(Sequence sequence)throws Exception{
        ByteArrayOutputStream out=new ByteArrayOutputStream();MidiSystem.write(sequence,1,out);return out.toByteArray();
    }
    static void midi(Track track,long tick,int command,int key,int value)throws Exception{
        ShortMessage message=new ShortMessage();message.setMessage(command,0,key,value);track.add(new MidiEvent(message,tick));
    }
    static void end(Track track,long tick)throws Exception{
        MetaMessage message=new MetaMessage();message.setMessage(47,new byte[0],0);track.add(new MidiEvent(message,tick));
    }
    static double timeOf(double[] events,int command,int key){
        for(int i=0;i<events.length;i+=4)if(events[i+1]==command&&events[i+2]==key)return events[i];
        throw new AssertionError("Missing event");
    }
    static void waitForSize(List<Integer> list,int count)throws Exception{
        long end=System.nanoTime()+TimeUnit.SECONDS.toNanos(3);
        while(list.size()<count&&System.nanoTime()<end)Thread.sleep(5);
        require(list.size()>=count,"media callback reached event "+count);
    }
    public static void main(String[] args)throws Exception{
        try {
            Mobile.isDoJa=true;Mobile.sound=false;Mobile.minLogLevel=Mobile.LOG_NONE;
            adpcmChecks();
            Sequence sequence=new Sequence(Sequence.PPQ,480);Track track=sequence.createTrack();
            midi(track,0,ShortMessage.PROGRAM_CHANGE,8,0);midi(track,0,ShortMessage.NOTE_ON,69,100);
            midi(track,480,ShortMessage.NOTE_OFF,69,0);
            MetaMessage tempo=new MetaMessage();tempo.setMessage(81,new byte[]{3,(byte)208,(byte)144},3); // 250,000 us/quarter
            track.add(new MidiEvent(tempo,480));midi(track,960,ShortMessage.NOTE_ON,72,100);end(track,1440);
            ClockPlayer clock=new ClockPlayer(new ByteArrayInputStream(bytes(sequence)));
            double[] events=clock.getAudioEvents();
            require(Math.abs(timeOf(events,0x80,69)-.5)<1e-8&&Math.abs(timeOf(events,0x90,72)-.75)<1e-8&&clock.getDuration()==1000000,
                "tempo changes preserve note-on/off timing and duration");
            Sequence smpte=new Sequence(Sequence.SMPTE_25,40);Track smpteTrack=smpte.createTrack();
            midi(smpteTrack,1000,ShortMessage.NOTE_ON,60,100);end(smpteTrack,2000);
            ClockPlayer absolute=new ClockPlayer(new ByteArrayInputStream(bytes(smpte)));
            require(timeOf(absolute.getAudioEvents(),0x90,60)==1&&absolute.getDuration()==2000000,"SMPTE timing uses frames per second");

            byte[] wave=new byte[44+1600];ByteBuffer buffer=ByteBuffer.wrap(wave).order(ByteOrder.LITTLE_ENDIAN);
            buffer.put("RIFF".getBytes("US-ASCII")).putInt(wave.length-8).put("WAVEfmt ".getBytes("US-ASCII"));
            buffer.putInt(16).putShort((short)1).putShort((short)1).putInt(8000).putInt(16000).putShort((short)2).putShort((short)16);
            buffer.put("data".getBytes("US-ASCII")).putInt(1600);
            ClockPlayer pcm=new ClockPlayer(new ByteArrayInputStream(wave));
            require(pcm.getDuration()==100000&&pcm.getAudioEvents()[1]==256,"PCM WAVE gets a timed playback event");
            boolean rejected=false;try{ClockPlayer.waveDuration(Arrays.copyOf(wave,50));}catch(IOException expected){rejected=true;}
            require(rejected,"truncated WAVE is rejected");

            Sequence seek=new Sequence(Sequence.PPQ,100);Track seekTrack=seek.createTrack();
            midi(seekTrack,10,ShortMessage.NOTE_ON,69,100);midi(seekTrack,11,ShortMessage.NOTE_OFF,69,0);
            midi(seekTrack,70,ShortMessage.NOTE_ON,69,100);midi(seekTrack,71,ShortMessage.NOTE_OFF,69,0);end(seekTrack,100);
            PlatformPlayer player=new PlatformPlayer(new ByteArrayInputStream(bytes(seek)),"audio/midi");player.prefetch();
            List<Integer> times=Collections.synchronizedList(new ArrayList<Integer>());
            CountDownLatch completed=new CountDownLatch(1);
            MediaListener listener=(presenter,event,value)->{if(event==AudioPresenter.AUDIO_SYNC)times.add(value);if(event==AudioPresenter.AUDIO_COMPLETE)completed.countDown();};
            player.setDoJaListener(listener,null);ClockPlayer.configure(player,listener,null,0,69);
            player.start();waitForSize(times,1);player.setMediaTime(300000);waitForSize(times,2);
            player.setMediaTime(0);waitForSize(times,3);player.stop();
            require(times.get(0)==50&&times.get(1)==350&&times.get(2)==50,"forward/backward seek resets the synchronization event cursor");
            int stopped=times.size();Thread.sleep(90);require(times.size()==stopped,"pause stops synchronization callbacks");
            player.setMediaTime(0);((PlatformPlayer.tempoControl)player.getControl("TempoControl")).setRate(200000);
            player.start();require(completed.await(2,TimeUnit.SECONDS),"rate-adjusted playback reaches completion");
            require(player.getMediaTime()==500000&&player.getState()==Player.PREFETCHED,"completed media clock is clamped and prefetched");player.close();
            System.out.println("ALL AUDIO CLOCK CHECKS PASSED");System.exit(0);
        }catch(Throwable error){error.printStackTrace();System.exit(1);}
    }
}
