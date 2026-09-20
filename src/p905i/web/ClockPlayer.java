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

/** A muted media clock: decodes timing and sends real sequence events, no synthesizer. */
public final class ClockPlayer extends BasicPlayer {
    private static final Map<Player,ClockPlayer> players = Collections.synchronizedMap(new WeakHashMap<Player,ClockPlayer>());
    private PlatformPlayer owner;
    private Sequence sequence;
    private final List<TimedNote> notes = new ArrayList<TimedNote>();
    private volatile boolean running;
    private volatile int generation;
    private int loops=1;
    private long position, epoch, duration=Player.TIME_UNKNOWN;
    private double rate=1;
    private MediaListener listener;
    private AudioPresenter presenter;
    private int syncChannel=-1, syncKey=-1;
    private static final class TimedNote {
        long time; int channel,key;
        TimedNote(long time,int channel,int key){this.time=time;this.channel=channel;this.key=key;}
    }

    public ClockPlayer(InputStream stream) {
        try {
            ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] buf=new byte[8192];int n;
            while((n=stream.read(buf))!=-1) out.write(buf,0,n);
            byte[] data=out.toByteArray();
            if(data.length>=4 && data[0]=='m' && data[1]=='e' && data[2]=='l' && data[3]=='o') {
                synchronized(MLDDecoder.class) {
                    MLDDecoder.decodeMLD(data);
                    if(MLDDecoder.SequenceData!=null) sequence=MidiSystem.getSequence(MLDDecoder.SequenceData);
                }
            } else if(data.length>=4 && data[0]=='M' && data[1]=='T' && data[2]=='h' && data[3]=='d') {
                sequence=MidiSystem.getSequence(new ByteArrayInputStream(data));
            }
            if(sequence!=null) buildTimeline();
        } catch(Exception e) { BrowserRuntime.recordLog("Media clock: timing could not be decoded: "+e); }
    }
    private void buildTimeline() {
        List<MidiEvent> events=new ArrayList<MidiEvent>();
        for(Track track:sequence.getTracks()) for(int i=0;i<track.size();i++) events.add(track.get(i));
        Collections.sort(events,new Comparator<MidiEvent>() {public int compare(MidiEvent a,MidiEvent b){return Long.compare(a.getTick(),b.getTick());}});
        long tick=0, micros=0;int tempo=500000;
        for(MidiEvent event:events) {
            micros += (event.getTick()-tick)*tempo/sequence.getResolution();tick=event.getTick();
            MidiMessage message=event.getMessage();
            if(message instanceof MetaMessage && ((MetaMessage)message).getType()==0x51) {
                byte[] d=((MetaMessage)message).getData();tempo=((d[0]&255)<<16)|((d[1]&255)<<8)|(d[2]&255);
            } else if(message instanceof ShortMessage) {
                ShortMessage m=(ShortMessage)message;
                if(m.getCommand()==ShortMessage.NOTE_ON && m.getData2()>0) notes.add(new TimedNote(micros,m.getChannel(),m.getData1()));
            }
        }
        duration=micros;
    }
    public void setPlatform(PlatformPlayer p) { super.setPlatform(p);owner=p;players.put(p,this); }
    public static void configure(Player p, MediaListener listener, AudioPresenter presenter,int channel,int key) {
        ClockPlayer c=players.get(p);
        if(c!=null) {
            c.listener=listener;c.presenter=presenter;c.syncChannel=channel;c.syncKey=key;
            if(channel>=0) {
                int count=0;for(TimedNote n:c.notes)if(n.channel==channel && n.key==key)count++;
                BrowserRuntime.recordLog("Media clock: duration="+c.duration+" us, sync channel="+channel+" key="+key+" events="+count);
            }
        }
    }
    public void realize(){owner.state=Player.REALIZED;}
    public void prefetch(){owner.state=Player.PREFETCHED;}
    public void setLoopCount(int count){loops=count;}
    public Sequence getSequence(){return sequence;}
    public long getDuration(){return duration;}
    public boolean isRunning(){return running;}
    public synchronized long getMediaTime(){return position+(running?(long)((System.nanoTime()-epoch)/1000.0*rate):0);}
    public synchronized long setMediaTime(long time){position=Math.max(0,time);epoch=System.nanoTime();return position;}
    public synchronized void setRate(double value){position=getMediaTime();epoch=System.nanoTime();rate=value;}
    public void start() {
        if(running)return;
        if(duration>0 && position>=duration)position=0;
        final int token=++generation;
        owner.state=Player.STARTED;
        // Notify before starting the clock so STARTED at position 0 stays PLAYING.
        owner.notifyListeners(PlayerListener.STARTED,Long.valueOf(position));
        epoch=System.nanoTime();running=true;
        Thread thread=new Thread(new Runnable(){public void run(){playTimeline(token);}},"muted-media-clock");
        thread.setDaemon(true);thread.start();
    }
    private void playTimeline(int token) {
        int index=0,remaining=loops;
        while(index<notes.size() && notes.get(index).time<position)index++;
        while(running && generation==token) {
            long now=getMediaTime();
            while(index<notes.size() && notes.get(index).time<=now) {
                TimedNote note=notes.get(index++);
                if(listener!=null && note.channel==syncChannel && note.key==syncKey) {
                    listener.mediaAction(presenter,AudioPresenter.AUDIO_SYNC,(int)(note.time/1000));
                }
            }
            if(duration>=0 && now>=duration) {
                if(remaining==-1 || --remaining>0) {
                    setMediaTime(0);index=0;owner.notifyListeners(PlayerListener.LOOPED,Long.valueOf(0));
                } else {
                    position=duration;running=false;owner.state=Player.PREFETCHED;
                    owner.notifyListeners(PlayerListener.END_OF_MEDIA,Long.valueOf(duration));return;
                }
            }
            try {Thread.sleep(5);}catch(InterruptedException e){return;}
        }
    }
    public void stop(){if(!running)return;position=getMediaTime();running=false;generation++;owner.state=Player.PREFETCHED;owner.notifyListeners(PlayerListener.STOPPED,Long.valueOf(position));}
    public void deallocate(){stop();}
    public void close(){stop();players.remove(owner);}
}
