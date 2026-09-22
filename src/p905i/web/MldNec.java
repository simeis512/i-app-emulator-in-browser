// SPDX-License-Identifier: GPL-3.0-or-later
package p905i.web;

import java.util.*;
import javax.microedition.media.decoders.WAVYamahaADPCMDecoder;
import javax.microedition.media.decoders.WAVTools;

/** NEC MFi mono stream-wave registration and StreamOn, without a MA-3 sound bank.
 * Packet field reference: vavi-sound Function1_240_7 and Function1_241_3
 * (a0487ed13066dbda5b6a20fe2c28292f8153b5da). Original adapter; existing decoder.
 */
public final class MldNec {
    private static final byte[] MARKER={'N','E','W','P'};
    private final List<byte[]> samples;
    private final int[] streams=new int[32], active={-1,-1,-1,-1};
    private int decodedBytes;
    private boolean warned;
    public MldNec(List<byte[]> samples){this.samples=samples;Arrays.fill(streams,-1);}
    public static byte[] wrap(byte[] message){
        if(message==null||message.length<1||(message[0]&255)!=0x11)return null;
        byte[] result=Arrays.copyOf(MARKER,MARKER.length+message.length);
        System.arraycopy(message,0,result,MARKER.length,message.length);return result;
    }
    private void warn(String reason){
        if(!warned){warned=true;BrowserRuntime.recordLog("Unsupported NEC MLD stream: "+reason);}
    }
    private static void event(List<Double> events,double time,int index,int velocity){
        events.add(time);events.add(256.0);events.add((double)index);events.add((double)velocity);
    }
    public boolean append(byte[] data,double time,List<Double> events){
        if(data==null||data.length<5)return false;
        for(int i=0;i<MARKER.length;i++)if(data[i]!=MARKER[i])return false;
        if(data.length<8||data[5]!=1){warn("command header");return true;}
        if((data[6]&255)==0xf0&&data[7]==7){
            if(data.length<12){warn("truncated registration");return true;}
            int stream=data[8]&255;
            if(stream>=streams.length){warn("stream number");return true;}
            // A failed replacement must not replay the old resource at this index.
            streams[stream]=-1;
            int rate=((data[10]&255)<<8)|(data[11]&255),length=data.length-12;
            if(data[9]!=1||rate<4000||rate>16000||length==0){
                warn("only mono format 1 at 4-16 kHz is supported");return true;
            }
            long expanded=44+(long)Math.ceil(length*4.0*WAVTools.hostSampleRate/rate);
            if(expanded+decodedBytes>16*1024*1024||samples.size()>=4096){warn("decoded data limit");return true;}
            byte[] wave;
            // Serialize with ADAT decoding, which shares the inherited decoder's scratch variables.
            synchronized(javax.microedition.media.decoders.MLDDecoder.class){
                wave=WAVYamahaADPCMDecoder.ADPCMZDecode(Arrays.copyOfRange(data,12,data.length),rate,1);
            }
            streams[stream]=samples.size();samples.add(wave);decodedBytes+=wave.length;
            return true;
        }
        if((data[6]&255)==0xf1&&(data[7]&63)==3){
            if(data.length!=10||(data[8]&255)>31){warn("invalid StreamOn");return true;}
            int channel=(data[7]&255)>>>6,index=streams[data[8]&31],velocity=data[9]&127;
            if(index<0){warn("StreamOn without a supported wave");return true;}
            if(active[channel]>=0)event(events,time,active[channel],0);
            active[channel]=index;event(events,time,index,velocity);return true;
        }
        warn("command "+(data[6]&255)+"/"+(data[7]&63));return true;
    }
}
