"""Local Java 8 build from pinned sources; no game binary modifications."""
from pathlib import Path
import subprocess, zipfile
from dependencies import verify
from build_support import clean_classes, add_file, add_bytes, add_notices, find_javac, MODIFIED
from build_state import RECORD, record

ROOT = Path(__file__).resolve().parent
VENDOR = ROOT / 'vendor/freej2me-plus-devel'
BUILD = ROOT / 'build'
WEB = ROOT / 'web'

def patched_sources():
    # Detect raw recovered scratchpads by their total size, not by an exception on
    # the last region. Otherwise the earlier regions silently shift by 64 bytes.
    rel = 'com/nttdocomo/util/ScratchPadConnection.java'
    text = (VENDOR / 'src' / rel).read_text(encoding='utf-8')
    old = 'int spDataStart = prevSizes + 64;'
    new = '''int declaredTotal = 0;
            for (String size : Mobile.iAppli.scratchPadSizes) declaredTotal += Integer.parseInt(size);
            int headerSize = data.length == declaredTotal + 64 ? 64 : 0;
            int spDataStart = prevSizes + headerSize;'''
    assert text.count(old) == 1
    text = text.replace(old, new).replace('scratchPadData.length-pos-1', 'scratchPadData.length-pos')
    dst = BUILD / 'patched' / rel
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(MODIFIED+text, encoding='utf-8')
    patches = {rel: dst}
    for rel, replacements in {
        'com/nttdocomo/ui/Canvas.java': [
            # The page draws the soft key labels below the screen, as the handset did, so the
            # upstream bar must not fade in and out over the application's own pixels.
            ('if (labelVisible) { paintCommandsBar(); }',
             '{ /* labels are reported to the browser frontend instead */ }'),
        ],
        'javax/microedition/media/decoders/WAVTools.java': [
            ('final int newLength = (int) (inputLength * ((double) newSampleRate / originalSampleRate));',
             '''int frameBytes = numChannels * (numBits / 8);
        final int newLength = ((int) (inputLength * ((double) newSampleRate / originalSampleRate)) / frameBytes) * frameBytes;'''),
        ],
        'javax/microedition/media/decoders/MLDDecoder.java': [
            ('if (chunkID.equals("adat"))      { decodeADATChunk(state); }',
             '''if (chunkID.equals("adat")) {
                state.readChunkId();
                int length = state.readChunkSize32();
                byte[] pcm = p905i.web.MldPcm.decodeAdat(state.input, state.decodePos, length);
                pcmData.add(pcm == null ? null : new ByteArrayInputStream(pcm));
                state.decodePos += length;
            }'''),
            ('SystemEvent(int trackIndex, int rawTick, int command, int value, int part, int timebase)',
             'byte[] machineData;\n            SystemEvent withMachineData(byte[] data) { machineData=data; return this; }\n            SystemEvent(int trackIndex, int rawTick, int command, int value, int part, int timebase)'),
            ('offset += length;\n\t\t\t\t\t\tevents.add(new SystemEvent(trackIndex, rawTick, command, -1, -1, -1));',
             '''byte[] machineData = command == 0xFF ? java.util.Arrays.copyOfRange(payload, offset, offset+length) : null;
                        offset += length;
                        events.add(new SystemEvent(trackIndex, rawTick, command, -1, -1, -1).withMachineData(machineData));'''),
            ('event.timebase);', 'event.timebase).withMachineData(event.machineData);'),
            ('maxTick = Math.max(maxTick, handleSystemEvent((SystemEvent) event, tempoPoints, warnings, renderState));',
             '''SystemEvent systemEvent = (SystemEvent) event;
                    byte[] packet = p905i.web.MldSharp.wrap(systemEvent.machineData);
                    if (packet == null) packet = p905i.web.MldNec.wrap(systemEvent.machineData);
                    if (packet != null) {
                        MetaMessage meta = new MetaMessage();
                        meta.setMessage(0x7F, packet, packet.length);
                        conductorTrack.add(new MidiEvent(meta, rawToMidiTick(tempoPoints, event.rawTick)));
                    }
                    maxTick = Math.max(maxTick, handleSystemEvent(systemEvent, tempoPoints, warnings, renderState));'''),
        ],
        'org/recompile/mobile/PlatformPlayer.java': [
            ('if(Mobile.sound == false) { player = new BasicPlayer(); disableControls = true; }',
             'if(Mobile.sound == false) { player = new p905i.web.ClockPlayer(stream); }'),
            ('// Set up control interfaces based on player type.',
             'if(player instanceof p905i.web.ClockPlayer) controls[1] = new tempoControl(player);\n\t\t// Set up control interfaces based on player type.'),
            ('float factor = rate / 100000.0f;',
             'float factor = rate / 100000.0f;\n            if(player instanceof p905i.web.ClockPlayer) ((p905i.web.ClockPlayer)player).setRate(factor);'),
            ('void applyVolume()\n\t\t{',
             'void applyVolume()\n\t\t{\n            if(player instanceof p905i.web.ClockPlayer) { ((p905i.web.ClockPlayer)player).setVolume(isMuted() ? 0 : volume); return; }'),
        ],
        'com/nttdocomo/ui/AudioPresenter.java': [
            ('private int priority, loopCount', 'private int syncChannel = -1, syncKey = -1;\n\tprivate boolean syncMode;\n\tprivate int priority, loopCount'),
            ('((PlatformPlayer)mediaSound.getPlayer()).setDoJaListener(listener, this);',
             '((PlatformPlayer)mediaSound.getPlayer()).setDoJaListener(listener, this);\n\t\tp905i.web.ClockPlayer.configure(mediaSound.getPlayer(), listener, this, syncMode ? syncChannel : -1, syncKey);'),
            ('Mobile.log(Mobile.LOG_WARNING, AudioPresenter.class.getPackage().getName() + "." + AudioPresenter.class.getSimpleName() + ": " + "setSyncMode (not implemented):" + (value == 1));',
             'syncMode = value == 1;'),
            ('Mobile.log(Mobile.LOG_WARNING, AudioPresenter.class.getPackage().getName() + "." + AudioPresenter.class.getSimpleName() + ": " + "setSyncEvent not implemented. channel: " + channel + " key:" + key);',
             'syncChannel = channel; syncKey = key;'),
        ],
        'org/recompile/mobile/MIDletEnhancements.java': [
            # Thread.yield only hands the CPU over. DoJa frames are already limited after each flush, so limiting
            # here as well added a whole frame of waiting to any loop that yields once per frame.
            ('public static void yieldOverride() throws InterruptedException { Mobile.getPlatform().limitFps(); }',
             'public static void yieldOverride() throws InterruptedException { if (Mobile.isDoJa) { Thread.yield(); return; } Mobile.getPlatform().limitFps(); }'),
        ],
        'org/recompile/mobile/Mobile.java': [
            ('synchronized (pendingLogs)\n\t\t{\n\t\t\tpendingLogs.add',
             'p905i.web.BrowserRuntime.recordLog("[" + logLevel + "] " + text);\n\t\tsynchronized (pendingLogs)\n\t\t{\n\t\t\tpendingLogs.add'),
        ],
        'org/recompile/mobile/PlatformGraphics.java': [
            ('canvasData[destRow + x] = blendPixels(imgData[imgY * imgWidth + imgX], canvasData[destRow + x]);',
             '''// Clip portions outside the source image, as Graphics2D does.
                    if (imgX >= 0 && imgX < imgWidth && imgY >= 0 && imgY < image.getHeight())
                        canvasData[destRow + x] = blendPixels(imgData[imgY * imgWidth + imgX], canvasData[destRow + x]);'''),
            # Handsets drew bitmap text. Antialiasing turns the common outline trick (the
            # string in black at eight offsets, then white on top) into an unreadable smear.
            ('gc.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON);',
             'gc.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING,\n\t\t\tMobile.isDoJa ? RenderingHints.VALUE_TEXT_ANTIALIAS_OFF : RenderingHints.VALUE_TEXT_ANTIALIAS_ON);'),
            # DoJa clips are relative to setOrigin, like every other drawing call; only
            # clearClip names the whole surface. Upstream made setClip absolute instead.
            ('else { gc.setClip(x-getTranslateX(), y-getTranslateY(), width, height); }',
             'else { gc.setClip(x, y, width, height); }'),
            ('public void clearClip()',
             'public void clearClip() { if(contextDisposed) { throw new UIException(UIException.ILLEGAL_STATE, "This graphics context has been disposed"); } gc.setClip(-translateX, -translateY, canvasWidth, canvasHeight); }\n\tprivate void clearClipFromTranslatedOrigin()'),
        ],
        'com/nttdocomo/ui/Font.java': [
            ('public static Font getFont(int type) { return getDefaultFont(); }',
             'public static Font getFont(int type)\n\t{\n\t\t// Decode face, style and size as openDoJa does; upstream returned one default for all.\n\t\tif (type == TYPE_DEFAULT) { return getDefaultFont(); }\n\t\tif (type == TYPE_HEADING) { type = FACE_SYSTEM | STYLE_BOLD | SIZE_LARGE; }\n\t\tint face = type & 0x7F000000, styleBits = type & 0x00FF0000, size = 0x70000000 | (type & 0x0000FF00);\n\t\tif (face != FACE_MONOSPACE && face != FACE_PROPORTIONAL) { face = FACE_SYSTEM; }\n\t\tint style = styleBits == 0x00110000 ? STYLE_BOLD : styleBits == 0x00120000 ? STYLE_ITALIC\n\t\t\t: styleBits == 0x00130000 ? STYLE_BOLDITALIC : STYLE_PLAIN;\n\t\tif (size != SIZE_TINY && size != SIZE_SMALL && size != SIZE_MEDIUM && size != SIZE_LARGE) { size = getDefaultFont().getSize(); }\n\t\t// Some applications ask for their font on every frame, so keep one object per request.\n\t\tInteger key = Integer.valueOf(face | style | size);\n\t\tsynchronized (requestedFonts)\n\t\t{\n\t\t\tFont font = requestedFonts.get(key);\n\t\t\tif (font == null) { font = new Font(face, style, size); requestedFonts.put(key, font); }\n\t\t\treturn font;\n\t\t}\n\t}\n\tprivate static final java.util.HashMap<Integer, Font> requestedFonts = new java.util.HashMap<Integer, Font>();'),
        ],
        'com/nttdocomo/util/ScratchPadOutputStream.java': [
            ('public void close() throws IOException \n    {', 'public void close() throws IOException \n    {\n        if (data == null) return;'),
            ('if (pos >= data.length) { return; }','if (pos >= len) { return; }'),
        ],
        'com/nttdocomo/ui/PhoneSystem.java': [
            ('if(attr != DEV_VENDOR && attr != DEV_VENDOR2) { attributes[attr] = value; }',
             'if(attr != DEV_VENDOR && attr != DEV_VENDOR2) { attributes[attr] = value; }\n        if(attr == DEV_VIBRATOR) p905i.web.BrowserRuntime.setVibrator(value);'),
            ('if (!isValidAttribute(attr, 0))',
             'if (!((attr >= DEV_BACKLIGHT && attr <= DEV_AREAINFO) || attr == DEV_VENDOR || attr == DEV_VENDOR2))'),
        ],
    }.items():
        text = (VENDOR/'src'/rel).read_text(encoding='utf-8')
        for old,new in replacements:
            expected = 2 if old=='((PlatformPlayer)mediaSound.getPlayer()).setDoJaListener(listener, this);' else 1
            assert text.count(old)==expected, (rel,old)
            text=text.replace(old,new)
        dst=BUILD/'patched'/rel;dst.parent.mkdir(parents=True,exist_ok=True)
        dst.write_text(MODIFIED+text,encoding='utf-8');patches[rel]=dst
    return patches

def build():
    compiler=find_javac()
    verify('freej2me-plus')
    verify('opendoja')
    BUILD.mkdir(exist_ok=True); WEB.mkdir(exist_ok=True)
    classes = BUILD / 'classes'; clean_classes(classes)
    patches = patched_sources()
    sources = [patches.get(p.relative_to(VENDOR/'src').as_posix(), p)
               for p in (VENDOR/'src').rglob('*.java')
               if not {'libretro','win32pad'}.intersection(p.parts) and p.name != 'package-info.java']
    sources += list((ROOT/'src').rglob('*.java'))
    sources.append(ROOT/'vendor/openDoJa-master/src/main/java/opendoja/audio/mld/MLDNativeADPCMDecoder.java')
    sources.sort(key=lambda p:p.as_posix())
    argfile = BUILD/'sources.txt'
    argfile.write_text('\n'.join('"'+p.as_posix()+'"' for p in sources), encoding='utf-8')
    subprocess.run([compiler,'-J-Duser.language=en','--release','8','-encoding','UTF-8','-d',str(classes),'@'+str(argfile)],check=True)
    jar = WEB/'p905i-runtime.jar'
    with zipfile.ZipFile(jar, 'w', zipfile.ZIP_DEFLATED) as z:
        for base in [classes, VENDOR/'resources']:
            for p in sorted(base.rglob('*'),key=lambda p:p.as_posix()):
                if p.is_file(): add_file(z,p,p.relative_to(base).as_posix())
        add_file(z,VENDOR/'LICENSE','META-INF/LICENSE-FreeJ2ME.txt')
        add_notices(z)
        add_bytes(z,record(ROOT,'runtime'),RECORD)
    print('Built',jar,jar.stat().st_size)

if __name__ == '__main__':
    build()
