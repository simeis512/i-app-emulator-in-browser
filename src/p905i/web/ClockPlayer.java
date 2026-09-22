// SPDX-License-Identifier: GPL-3.0-or-later
package p905i.web;

import java.io.*;
import java.util.*;
import javax.sound.midi.*;
import javax.microedition.media.Player;
import javax.microedition.media.PlayerListener;
import javax.microedition.media.decoders.MLDDecoder;
import org.recompile.mobile.PlatformPlayer;
import org.recompile.mobile.players.BasicPlayer;
import com.nttdocomo.ui.*;

/** Media clock and browser audio transport sharing one decoded event timeline. */
public final class ClockPlayer extends BasicPlayer {
    private static final Map<Player,ClockPlayer> players=Collections.synchronizedMap(new WeakHashMap<Player,ClockPlayer>());
    private final int audioId=BrowserAudio.allocate();
    private PlatformPlayer owner;
    private Sequence sequence;
    private final List<TimedNote> notes=new ArrayList<TimedNote>();
    private double[] audioEvents=new double[0];
    private volatile boolean running;
    private volatile int generation,revision;
    private int loops=1,volume=100;
    private long position,epoch,duration=Player.TIME_UNKNOWN;
    private double rate=1;
    private volatile MediaListener listener;
    private volatile AudioPresenter presenter;
    private volatile int syncChannel=-1,syncKey=-1;
    private static final class TimedNote {
        final long time;final int channel,key;
        TimedNote(long time,int channel,int key){this.time=time;this.channel=channel;this.key=key;}
    }
    private static byte[] read(InputStream stream) throws IOException {
        ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] buf=new byte[8192];int n;
        while((n=stream.read(buf))!=-1){
            if(out.size()+n>16*1024*1024)throw new IOException("Audio stream exceeds 16 MiB");
            out.write(buf,0,n);
        }
        return out.toByteArray();
    }
    public ClockPlayer(InputStream stream){
        List<byte[]> samples=new ArrayList<byte[]>();
        try{
            byte[] data=read(stream);
            if(data.length>=4&&data[0]=='m'&&data[1]=='e'&&data[2]=='l'&&data[3]=='o'){
                synchronized(MLDDecoder.class){
                    MLDDecoder.decodeMLD(data);
                    if(MLDDecoder.SequenceData!=null)sequence=MidiSystem.getSequence(MLDDecoder.SequenceData);
                    if(MLDDecoder.pcmData!=null)for(InputStream pcm:MLDDecoder.pcmData)samples.add(pcm==null?null:read(pcm));
                }
            }else if(data.length>=4&&data[0]=='M'&&data[1]=='T'&&data[2]=='h'&&data[3]=='d'){
                sequence=MidiSystem.getSequence(new ByteArrayInputStream(data));
            }else if(data.length>=12&&data[0]=='R'&&data[1]=='I'&&data[2]=='F'&&data[3]=='F'){
                duration=waveDuration(data);samples.add(data);audioEvents=new double[]{0,256,0,127};
            }
            if(sequence!=null)buildTimeline(samples);
            if(duration==0&&!samples.isEmpty())for(byte[] sample:samples)if(sample!=null)duration=Math.max(duration,waveDuration(sample));
            BrowserAudio.load(audioId,audioEvents,duration);
            for(int i=0;i<samples.size();i++)if(samples.get(i)!=null)BrowserAudio.sample(audioId,i,samples.get(i));
            if(duration==Player.TIME_UNKNOWN)BrowserRuntime.recordLog("Media clock: unsupported audio format");
        }catch(Exception e){BrowserRuntime.recordLog("Media clock: audio could not be decoded: "+e);}
    }
    private static long uint32(byte[] data,int offset){
        return (data[offset]&255L)|((data[offset+1]&255L)<<8)|((data[offset+2]&255L)<<16)|((data[offset+3]&255L)<<24);
    }
    /** Duration of uncompressed RIFF WAVE, including padded and unknown chunks. */
    public static long waveDuration(byte[] data) throws IOException {
        if(data.length<12||data[8]!='W'||data[9]!='A'||data[10]!='V'||data[11]!='E')throw new IOException("Not a WAVE file");
        long byteRate=0,bytes=-1;
        for(int offset=12;offset+8<=data.length;){
            long size=uint32(data,offset+4),end=offset+8L+size;
            if(end>data.length)throw new IOException("Truncated WAVE chunk");
            if(data[offset]=='f'&&data[offset+1]=='m'&&data[offset+2]=='t'&&data[offset+3]==' '){
                if(size<16)throw new IOException("Invalid WAVE format");
                int format=(data[offset+8]&255)|((data[offset+9]&255)<<8);
                if(format!=1&&format!=3)throw new IOException("Compressed WAVE not supported");
                byteRate=uint32(data,offset+16);
            }
            if(data[offset]=='d'&&data[offset+1]=='a'&&data[offset+2]=='t'&&data[offset+3]=='a')bytes=size;
            offset=(int)(end+(size&1));
        }
        if(byteRate==0||bytes<0)throw new IOException("Missing WAVE format/data");
        return bytes*1000000L/byteRate;
    }
    private void buildTimeline(List<byte[]> samples){
        List<MidiEvent> events=new ArrayList<MidiEvent>();
        for(Track track:sequence.getTracks())for(int i=0;i<track.size();i++)events.add(track.get(i));
        Collections.sort(events,new Comparator<MidiEvent>(){public int compare(MidiEvent a,MidiEvent b){return Long.compare(a.getTick(),b.getTick());}});
        List<Double> output=new ArrayList<Double>();long tick=0;double micros=0;int tempo=500000;
        MldSharp sharp=new MldSharp(samples);
        float division=sequence.getDivisionType();
        for(MidiEvent event:events){
            double perTick=division==Sequence.PPQ?(double)tempo/sequence.getResolution():1000000.0/(division*sequence.getResolution());
            micros+=(event.getTick()-tick)*perTick;tick=event.getTick();MidiMessage message=event.getMessage();
            int status=-1,a=0,b=0;
            if(message instanceof MetaMessage){
                MetaMessage meta=(MetaMessage)message;byte[] data=meta.getData();
                if(meta.getType()==0x51&&data.length==3&&division==Sequence.PPQ){
                    int value=((data[0]&255)<<16)|((data[1]&255)<<8)|(data[2]&255);if(value>0)tempo=value;
                }else if(meta.getType()==0x7f&&sharp.append(data,micros/1000000.0,output))continue;
                else if(meta.getType()==0x7f&&data.length==2){status=256;a=data[0]&255;b=data[1]&255;}
                else if(MLDDecoder.MLDSequenceMarker.isStopMarker(MLDDecoder.MLDSequenceMarker.decodeMarker(meta)))status=257;
            }else if(message instanceof ShortMessage){
                ShortMessage m=(ShortMessage)message;status=m.getStatus();a=m.getData1();b=m.getData2();
                if(m.getCommand()==ShortMessage.NOTE_ON&&b>0)notes.add(new TimedNote(Math.round(micros),m.getChannel(),a));
            }
            if(status>=0){output.add(micros/1000000.0);output.add((double)status);output.add((double)a);output.add((double)b);}
        }
        duration=Math.round(micros);audioEvents=new double[output.size()];
        for(int i=0;i<audioEvents.length;i++)audioEvents[i]=output.get(i);
    }
    public double[] getAudioEvents(){return audioEvents.clone();}
    public void setPlatform(PlatformPlayer p){super.setPlatform(p);owner=p;players.put(p,this);}
    public static void configure(Player p,MediaListener listener,AudioPresenter presenter,int channel,int key){
        ClockPlayer c=players.get(p);
        if(c!=null){c.listener=listener;c.presenter=presenter;c.syncChannel=channel;c.syncKey=key;BrowserAudio.sync(c.audioId,channel,key);}
    }
    public void realize(){owner.state=Player.REALIZED;}
    public void prefetch(){owner.state=Player.PREFETCHED;}
    public void setLoopCount(int count){loops=count;}
    public Sequence getSequence(){return sequence;}
    public long getDuration(){return duration;}
    public boolean isRunning(){return running;}
    public synchronized long getMediaTime(){
        long now=position+(running?(long)((System.nanoTime()-epoch)/1000.0*rate):0);
        return duration>=0?Math.min(duration,now):now;
    }
    private void output(int command){BrowserAudio.control(audioId,command,position,rate,volume);}
    public synchronized long setMediaTime(long time){
        position=Math.max(0,duration>=0?Math.min(duration,time):time);epoch=System.nanoTime();revision++;
        if(running)output(1);return position;
    }
    public synchronized void setRate(double value){
        if(!Double.isFinite(value)||value<=0)throw new IllegalArgumentException("Invalid media rate");
        if(rate==value)return;position=getMediaTime();epoch=System.nanoTime();rate=value;if(running)output(1);
    }
    public synchronized void setVolume(int value){volume=Math.max(0,Math.min(100,value));output(3);}
    public synchronized void start(){
        if(running)return;if(duration>=0&&position>=duration)position=0;
        final int token=++generation;owner.state=Player.STARTED;
        owner.notifyListeners(PlayerListener.STARTED,Long.valueOf(position));
        epoch=System.nanoTime();running=true;output(1);
        Thread thread=new Thread(new Runnable(){public void run(){playTimeline(token);}},"browser-media-clock");
        thread.setDaemon(true);thread.start();
    }
    private void playTimeline(int token){
        int index=0,remaining=loops,seenRevision=-1;
        while(running&&generation==token){
            long now;
            synchronized(this){
                if(seenRevision!=revision){index=0;while(index<notes.size()&&notes.get(index).time<position)index++;seenRevision=revision;}
                now=getMediaTime();
            }
            while(running&&generation==token&&seenRevision==revision&&index<notes.size()&&notes.get(index).time<=now){
                TimedNote note=notes.get(index++);MediaListener target=listener;
                if(target!=null&&note.channel==syncChannel&&note.key==syncKey)target.mediaAction(presenter,AudioPresenter.AUDIO_SYNC,(int)(note.time/1000));
            }
            synchronized(this){
                if(!running||generation!=token)break;
                if(duration>=0&&now>=duration&&seenRevision==revision){
                    if(duration>0&&(remaining==-1||--remaining>0)){
                        position=0;epoch=System.nanoTime();revision++;output(1);owner.notifyListeners(PlayerListener.LOOPED,Long.valueOf(0));
                    }else{
                        position=duration;running=false;owner.state=Player.PREFETCHED;output(2);
                        owner.notifyListeners(PlayerListener.END_OF_MEDIA,Long.valueOf(duration));return;
                    }
                }
            }
            try{Thread.sleep(5);}catch(InterruptedException e){return;}
        }
    }
    public synchronized void stop(){
        if(!running)return;position=getMediaTime();running=false;generation++;owner.state=Player.PREFETCHED;output(2);
        owner.notifyListeners(PlayerListener.STOPPED,Long.valueOf(position));
    }
    public void deallocate(){stop();}
    public void close(){stop();output(4);players.remove(owner);}
}
