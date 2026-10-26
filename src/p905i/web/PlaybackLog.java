// SPDX-License-Identifier: GPL-3.0-or-later
package p905i.web;

import java.util.*;
import javax.microedition.media.Player;
import com.nttdocomo.ui.*;
import com.nttdocomo.ui.impls.MediaSoundImpl;

/** Reports why a sound is refused before upstream throws; applications often swallow the exception (#22). */
public final class PlaybackLog {
    private static final Map<Object,String> reported=Collections.synchronizedMap(new WeakHashMap<Object,String>());
    private PlaybackLog(){}
    /** Mirrors the checks AudioPresenter.play/restart make, including the ones that end in a NullPointerException. */
    public static String refusal(MediaSound sound,MediaData data){
        if(sound==null)return data==null?"no sound set":"MediaData is not supported, only MediaSound";
        Player player=((MediaSoundImpl)sound).getPlayer();
        if(player==null)return "sound was disposed or could not be loaded";
        int state=player.getState();
        if(state==Player.CLOSED)return "player is closed";
        return state<Player.REALIZED?"use() has not been called":null;
    }
    public static void presenter(String call,AudioPresenter presenter,MediaSound sound,MediaData data){
        report(presenter,"AudioPresenter."+call,refusal(sound,data),sound);
    }
    public static void use(MediaSoundImpl sound,boolean disposed){
        report(sound,"MediaSound.use",disposed?"sound was disposed or already used once":sound.getPlayer()==null?"sound could not be loaded":null,sound);
    }
    /** One line per object and reason, so a retry every frame does not flood the log. */
    private static void report(Object owner,String call,String reason,MediaSound sound){
        if(reason==null){reported.remove(owner);return;}
        if(reason.equals(reported.put(owner,reason)))return;
        BrowserRuntime.recordLog(call+" refused: "+reason+" ("+describe(sound)+")");
    }
    public static String describe(MediaSound sound){
        if(!(sound instanceof MediaSoundImpl))return "no sound";
        MediaSoundImpl impl=(MediaSoundImpl)sound;Player player=impl.getPlayer();
        String source=impl.source.length()>0?impl.source:"data";
        return player==null?source:source+", "+ClockPlayer.describe(player)+", state "+player.getState();
    }
}
