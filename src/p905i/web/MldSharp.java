// SPDX-License-Identifier: GPL-3.0-or-later
package p905i.web;

import java.util.*;

/** SH MFi single-packet, immediate ADPCM effects. No instrument ROM required.
 * Packet field reference: vavi-sound Function131/132 (a0487ed13066dbda5b6a20fe2c28292f8153b5da).
 * This adapter is original code; decoding uses our existing MldPcm path.
 */
public final class MldSharp {
    private static final byte[] MARKER={'S','H','W','P'};
    private final List<byte[]> samples;
    private final int[] volume={126,126,126,126}, active={-1,-1,-1,-1};
    private int decodedBytes;
    private boolean warned;
    public MldSharp(List<byte[]> samples){this.samples=samples;}
    public static byte[] wrap(byte[] message){
        if(message==null||message.length<2||(message[0]&255)!=0x71)return null;
        byte[] data=Arrays.copyOf(MARKER,MARKER.length+message.length);
        System.arraycopy(message,0,data,MARKER.length,message.length);return data;
    }
    private void warn(String reason){
        if(!warned){warned=true;BrowserRuntime.recordLog("Unsupported SH MLD wave packet: "+reason);}
    }
    private static void event(List<Double> events,double time,int index,int level){
        events.add(time);events.add(256.0);events.add((double)index);events.add((double)level);
    }
    public boolean append(byte[] data,double time,List<Double> events){
        if(data==null||data.length<6)return false;
        for(int i=0;i<MARKER.length;i++)if(data[i]!=MARKER[i])return false;
        int command=data[5]&255;
        if(command==0x81){
            if(data.length!=7){warn("invalid volume command");return true;}
            int channel=(data[6]&255)>>>6;volume[channel]=(data[6]&63)*2;
            // Initial volume and subsequent packet triggers are supported. Live
            // changes to a wave already playing need a separate PCM controller.
            if(active[channel]>=0)warn("volume change during packet playback");
            return true;
        }
        if(command==0x8f)return true; // Setup metadata; format/mode are in each packet.
        if(command==0x82){
            if(data.length!=7||(data[6]&63)!=32)warn("non-centered PCM pan");
            return true;
        }
        if(command!=0x83&&command!=0x84){warn("command "+command);return true;}
        int header=command==0x84?13:9;
        if(data.length<=header){warn("truncated or empty packet");return true;}
        int channel=(data[6]&255)>>>6,format=data[7]&63,mode=(data[7]&255)>>>6;
        int rateCode=format>>>2,bitsCode=format&3;
        // Only self-contained mono SET packets. Do not reinterpret continued,
        // stored/recycled or unknown streams as raw PCM/noise.
        if(mode!=1||data[8]!=0||(rateCode!=1&&rateCode!=3)||bitsCode>1){
            warn("mode/continuation/sample format");return true;
        }
        int length=data.length-header;
        if(command==0x84){
            long declared=((data[9]&255L)<<24)|((data[10]&255L)<<16)|((data[11]&255L)<<8)|(data[12]&255L);
            if(declared!=length){warn("split or inconsistent packet length");return true;}
        }
        int rate=rateCode==1?8:16,bits=bitsCode==0?2:4;
        long waveBytes=44L+length*(8/bits)*(32/rate)*2L;
        if(waveBytes+decodedBytes>16*1024*1024||samples.size()>=4096){warn("decoded data limit");return true;}
        byte[] adat=new byte[13+length];adat[1]=11;adat[2]=(byte)0x81;
        adat[4]='a';adat[5]='d';adat[6]='p';adat[7]='m';adat[9]=3;
        adat[10]=(byte)rate;adat[11]=(byte)bits;adat[12]=1;
        System.arraycopy(data,header,adat,13,length);
        byte[] wave=MldPcm.decodeAdat(adat,0,adat.length);
        if(wave==null){warn("decoder unavailable");return true;}
        int index=samples.size();samples.add(wave);decodedBytes+=wave.length;
        if(active[channel]>=0)event(events,time,active[channel],0);
        active[channel]=index;event(events,time,index,volume[channel]);return true;
    }
}
