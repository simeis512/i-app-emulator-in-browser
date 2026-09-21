// SPDX-License-Identifier: GPL-3.0-or-later
package p905i.web;

import java.util.Arrays;
import javax.microedition.media.decoders.WAVYamahaADPCMDecoder;
import javax.microedition.media.decoders.WAVTools;
import opendoja.audio.mld.MLDNativeADPCMDecoder;

/** Decode an MFi ADAT body while retaining its resource index when unsupported. */
public final class MldPcm {
    private static final int MAX_WAVE_BYTES=16*1024*1024;
    private MldPcm() {}
    private static int be16(byte[] data,int offset){return ((data[offset]&255)<<8)|(data[offset+1]&255);}
    private static void require(boolean condition,String message){if(!condition)throw new IllegalArgumentException(message);}
    public static byte[] decodeAdat(byte[] data,int offset,int length){
        require(offset>=0&&length>=4&&(long)offset+length<=data.length,"Truncated MLD ADAT body");
        int end=offset+length,headerLength=be16(data,offset),headerEnd=offset+2+headerLength;
        require(headerLength>=2&&headerEnd<=end,"Invalid MLD ADAT header length");
        int selector=data[offset+2]&255,rate=0,bits=0,mode=0;
        for(int part=offset+4;part<headerEnd;){
            require(part+6<=headerEnd,"Truncated MLD ADAT subchunk");
            int size=be16(data,part+4),body=part+6;
            require(body+size<=headerEnd,"Truncated MLD ADPM header");
            if(data[part]=='a'&&data[part+1]=='d'&&data[part+2]=='p'&&data[part+3]=='m'){
                require(size>=3,"Invalid MLD ADPM parameters");
                rate=(data[body]&255)*1000;bits=data[body+1]&255;mode=data[body+2]&255;
            }
            part=body+size;
        }
        int channels=mode&7,bytes=end-headerEnd;
        require(rate>0&&channels>0,"Missing MLD ADPM format");
        if(selector==0x81&&mode==1&&MLDNativeADPCMDecoder.supportsLivePath(rate,bits,channels)){
            long frames=(long)bytes*(8/bits)*(32000/rate);
            require(44+frames*2<=MAX_WAVE_BYTES,"Decoded MLD PCM exceeds 16 MiB");
            int[] nativeFrames=MLDNativeADPCMDecoder.decodeLiveMonoNativeLane0(rate,bits,Arrays.copyOfRange(data,headerEnd,end));
            // openDoJa's native lane stores signed 16-bit PCM shifted left by 8.
            // Keep the decoder's 32 kHz reconstruction filter, not its mixer gain.
            byte[] wave=waveHeader(nativeFrames.length,32000);
            for(int i=0;i<nativeFrames.length;i++)le16(wave,44+i*2,nativeFrames[i]>>8);
            return wave;
        }
        if(selector==0x80&&bits==16&&mode==1){
            require(bytes%2==0&&44L+bytes<=MAX_WAVE_BYTES,"Invalid MLD PCM16 payload length");
            byte[] wave=waveHeader(bytes/2,rate);System.arraycopy(data,headerEnd,wave,44,bytes);return wave;
        }
        if(bits==4&&(channels==1||channels==2)){
            // Retain the previous decoder for formats outside the native subset.
            long expandedBytes=(long)Math.ceil(bytes*4.0*WAVTools.hostSampleRate/rate);
            require(44L+bytes*4L<=MAX_WAVE_BYTES&&44+expandedBytes<=MAX_WAVE_BYTES,"Decoded MLD PCM exceeds 16 MiB");
            return WAVYamahaADPCMDecoder.ADPCMZDecode(Arrays.copyOfRange(data,headerEnd,end),rate,channels);
        }
        BrowserRuntime.recordLog("Unsupported MLD PCM: selector="+selector+", "+rate+" Hz, "+bits+" bit, mode="+mode);
        return null;
    }
    // Explicit byte writes also work around zeroed ByteBuffer.putShort output
    // observed in the browser's Java 17 runtime (both headers and PCM samples).
    private static void le16(byte[] data,int offset,int value){data[offset]=(byte)value;data[offset+1]=(byte)(value>>8);}
    private static void le32(byte[] data,int offset,int value){le16(data,offset,value);le16(data,offset+2,value>>16);}
    private static byte[] waveHeader(int frames,int rate){
        byte[] wave=new byte[44+frames*2];
        le32(wave,0,0x46464952);le32(wave,4,36+frames*2);le32(wave,8,0x45564157);le32(wave,12,0x20746d66);
        le32(wave,16,16);le16(wave,20,1);le16(wave,22,1);le32(wave,24,rate);le32(wave,28,rate*2);
        le16(wave,32,2);le16(wave,34,16);le32(wave,36,0x61746164);le32(wave,40,frames*2);
        return wave;
    }
}
