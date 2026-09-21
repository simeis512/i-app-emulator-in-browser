// SPDX-License-Identifier: GPL-3.0-or-later
package p905i.web;

/** Optional browser output; desktop checks need no audio device. */
public final class BrowserAudio {
    private static volatile boolean enabled;
    private static int nextId;
    public static synchronized int allocate(){return ++nextId;}
    public static void enable(boolean value){enabled=value;}
    private static native void loadNative(int id,double[] events,double duration);
    private static native void sampleNative(int id,int index,byte[] wave);
    private static native void controlNative(int id,int command,double position,double rate,double volume);
    private static native void syncNative(int id,int channel,int key);
    private static void failed(Throwable error){enabled=false;BrowserRuntime.recordLog("Browser audio disabled: "+error);}
    public static void load(int id,double[] events,long duration){
        if(enabled)try{loadNative(id,events,duration/1000000.0);}catch(Throwable e){failed(e);}
    }
    public static void sample(int id,int index,byte[] wave){
        if(enabled)try{sampleNative(id,index,wave);}catch(Throwable e){failed(e);}
    }
    // 1 start/resume/seek, 2 pause/end, 3 gain, 4 close.
    public static void control(int id,int command,long position,double rate,int volume){
        if(enabled)try{controlNative(id,command,position/1000000.0,rate,volume/100.0);}catch(Throwable e){failed(e);}
    }
    public static void sync(int id,int channel,int key){
        if(enabled)try{syncNative(id,channel,key);}catch(Throwable e){failed(e);}
    }
}
