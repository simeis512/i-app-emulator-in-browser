package p905i.web;

import java.awt.image.BufferedImage;
import java.awt.image.DataBufferInt;
import java.io.*;
import java.util.HashMap;
import javax.imageio.ImageIO;
import org.recompile.mobile.*;
import com.nttdocomo.ui.IApplication;

/** Local DoJa frontend. One application per JVM/page. GPL-3.0-or-later. */
public final class BrowserRuntime {
    private static MobilePlatform platform;
    private static volatile long frames;
    private static volatile String failure = "";
    private static final ByteArrayOutputStream log = new ByteArrayOutputStream();
    private static final StringBuilder events = new StringBuilder();
    private static final java.util.Set<Integer> held = new java.util.HashSet<Integer>();
    /** Browser-side code for CLEAR, outside every key range the upstream tables use. */
    public static final int CLEAR = -8;
    private static native void present(int[] argb, int width, int height);
    private static native void softLabels(byte[] utf8);
    private static native void vibrate(int on);
    private static String labels = "";
    private static int vibrating = -1;

    public static synchronized void start(String jar, String jam, String sp, String saves,
            int width, int height, final boolean browser) throws Exception {
        if (platform != null) throw new IllegalStateException("Reload the page before changing applications");
        final PrintStream original = System.out;
        PrintStream capture = new PrintStream(new OutputStream() {
            public void write(int b) {
                synchronized (log) { if (log.size() > 120000) log.reset(); log.write(b); }
                original.write(b);
            }
        }, true, "UTF-8");
        System.setOut(capture); System.setErr(capture);
        Thread.setDefaultUncaughtExceptionHandler(new Thread.UncaughtExceptionHandler() {
            public void uncaughtException(Thread t, Throwable e) { failed(e); }
        });
        Mobile.isDoJa = true;
        Mobile.DoJaVersion = 51;
        Mobile.textEncoding = "Shift_JIS";
        Mobile.sound = false;
        BrowserAudio.enable(browser);
        Mobile.limitFPS = 30;
        Mobile.maskIndex = 0;
        Mobile.minLogLevel = Mobile.LOG_INFO;
        Mobile.clearOldLog();
        platform = new MobilePlatform(width, height);
        Mobile.setPlatform(platform, new Runnable() { public void run() {} });
        platform.dataPath = saves + "/";
        new File(saves).mkdirs();
        MobilePlatform.spFileName = new File(sp).toURI().toString();
        final HashMap<String,String> props;
        try(InputStream descriptor=new FileInputStream(jam)) { props=readDescriptor(descriptor); }
        platform.loader = new MIDletLoader(new File(jar).toURI().toURL(), props);
        // Stable ASCII names avoid host/browser encoding differences in save paths.
        platform.loader.suitename = "app";
        MIDletLoader.MIDletSelected = true;
        platform.setPainter(new Runnable() {
            public void run() {
                frames++;
                if (browser) {
                    BufferedImage img = platform.getLcdFrontbuffer().getCanvas();
                    present(((DataBufferInt) img.getRaster().getDataBuffer()).getData(), img.getWidth(), img.getHeight());
                    pushLabels();pushVibrator();
                }
            }
        });
        new Thread(new Runnable() {
            public void run() {
                try {
                    IApplication.initAppProperties(props);
                    java.lang.reflect.Constructor<?> c = platform.loader.loadClass(props.get("AppClass")).getDeclaredConstructor();
                    c.setAccessible(true);
                    IApplication app = (IApplication)c.newInstance();
                    app.start();
                } catch (Throwable e) { failed(e); }
            }
        }, "i-appli").start();
    }

    /** Match the frontend's folded-line rules; normalize numeric region values. */
    public static HashMap<String,String> readDescriptor(InputStream input) throws IOException {
        HashMap<String,String> props=new HashMap<String,String>();
        BufferedReader reader=new BufferedReader(new InputStreamReader(input,"Shift_JIS"));
        String line,key=null;
        while((line=reader.readLine())!=null) {
            if(line.startsWith("\uFEFF"))line=line.substring(1);
            if(line.trim().isEmpty())continue;
            if((line.startsWith(" ") || line.startsWith("\t")) && key!=null) {
                props.put(key,props.get(key)+line.trim());continue;
            }
            int equal=line.indexOf('=');
            if(equal<1){key=null;continue;}
            key=line.substring(0,equal).trim();props.put(key,line.substring(equal+1).trim());
        }
        if(!props.containsKey("AppClass") || props.get("AppClass").isEmpty())
            throw new IOException("JAM requires AppClass");
        if(props.containsKey("SPsize")) {
            String[] sizes=props.get("SPsize").split(",",-1);long total=0;
            if(sizes.length>16)throw new IOException("Too many scratchpad regions");
            for(int i=0;i<sizes.length;i++) {
                sizes[i]=sizes[i].trim();
                if(!sizes[i].matches("[0-9]+"))throw new IOException("Invalid SPsize");
                try { sizes[i]=Integer.toString(Integer.parseInt(sizes[i]));total+=Integer.parseInt(sizes[i]); }
                catch(NumberFormatException e){throw new IOException("Invalid SPsize",e);}
            }
            if(total>64L*1024*1024)throw new IOException("Scratchpad exceeds 64 MiB");
            props.put("SPsize",String.join(",",sizes));
        }
        return props;
    }

    private static void failed(Throwable e) {
        while (e.getCause() != null && (e instanceof java.lang.reflect.InvocationTargetException
                || e instanceof ExceptionInInitializerError)) e = e.getCause();
        failure = e.toString();
        recordLog("FATAL: " + failure);
        e.printStackTrace();
    }
    /** The handset showed the soft key labels outside the application area, so report them
     * to the page instead of painting over the application's own pixels. */
    private static void pushLabels() {
        com.nttdocomo.ui.Frame frame = com.nttdocomo.ui.Display.getCurrent();
        String left = "", right = "";
        if (frame != null && frame.labelVisible) {
            if (frame.softLabels[0] != null) left = frame.softLabels[0];
            if (frame.softLabels[1] != null) right = frame.softLabels[1];
        }
        String current = left + (char) 10 + right;
        if (current.equals(labels)) return;
        labels = current;
        try { softLabels(current.getBytes("UTF-8")); } catch (java.io.UnsupportedEncodingException e) { }
    }
    /** Upstream only records the vibrator attribute, so report it to the page. */
    private static void pushVibrator() {
        int on = com.nttdocomo.ui.PhoneSystem.getAttribute(com.nttdocomo.ui.PhoneSystem.DEV_VIBRATOR);
        if (on == vibrating) return;
        vibrating = on;
        // Report it so a silent device can be told from an application that never asked.
        recordLog("Application vibrator " + (on != 0 ? "on" : "off"));
        vibrate(on);
    }
    public static synchronized void recordLog(String line) {
        if (events.length() > 60000) events.delete(0,30000);
        events.append(line).append('\n');
    }
    /** The upstream key table cannot carry CLEAR: its DoJa constant collides with FIRE as a
     * switch label, and 1 << KEY_CLEAR falls back onto the KEY_0 bit of the 32-bit keypad
     * state. Deliver the event directly instead, leaving that state untouched. */
    private static void clear(boolean down) {
        com.nttdocomo.ui.Frame frame = com.nttdocomo.ui.Display.getCurrent();
        if (!(frame instanceof com.nttdocomo.ui.Canvas)) return;
        ((com.nttdocomo.ui.Canvas) frame).processEvent(down ? com.nttdocomo.ui.Display.KEY_PRESSED_EVENT
                : com.nttdocomo.ui.Display.KEY_RELEASED_EVENT, com.nttdocomo.ui.Display.KEY_CLEAR);
    }
    public static synchronized void key(int code, boolean down) {
        if (platform == null || MobilePlatform.appTerminated) return;
        try {
            if (down == held.contains(code)) return;
            if (down) held.add(code); else held.remove(code);
            if (code == CLEAR) clear(down);
            else if (down) platform.keyPressed(code);
            else platform.keyReleased(code);
        } catch (Throwable e) { failed(e); }
    }
    public static synchronized void releaseAll() {
        for (Integer code : held.toArray(new Integer[0])) key(code, false);
    }
    public static String getStatus() {
        return failure.length() > 0 ? "ERROR: " + failure :
            MobilePlatform.appTerminated ? "TERMINATED" : "FRAMES: " + frames;
    }
    public static String getLog() throws Exception {
        synchronized (BrowserRuntime.class) { return events.toString(); }
    }
    /** Export current records as a concatenated, headerless DoJa scratchpad. */
    public static String exportScratchpad() throws IOException {
        String[] sizes=IApplication.scratchPadSizes;
        if(sizes==null)throw new IOException("Application has not initialized its scratchpad");
        ByteArrayOutputStream output=new ByteArrayOutputStream();
        for(int i=0;i<sizes.length;i++) {
            int size=Integer.parseInt(sizes[i].trim());
            if(size==0)continue;
            com.nttdocomo.util.ScratchPadConnection connection=new com.nttdocomo.util.ScratchPadConnection("scratchpad:///"+i);
            try(InputStream input=connection.openInputStream()) {
                if(input==null)throw new IOException("Could not read scratchpad region "+i);
                byte[] region=new byte[size];new DataInputStream(input).readFully(region);output.write(region);
            }finally{connection.close();}
        }
        return java.util.Base64.getEncoder().encodeToString(output.toByteArray());
    }
    public static void screenshot(String path) throws IOException {
        synchronized (platform.getLcdFrontbuffer()) {
            ImageIO.write(platform.getLcdFrontbuffer().getCanvas(), "png", new File(path));
        }
    }
    /** Headless reproducible probe: jar jam sp savedir width height seconds outdir [second:key,...] */
    public static void main(String[] args) throws Exception {
        start(args[0], args[1], args[2], args[3], Integer.parseInt(args[4]), Integer.parseInt(args[5]), false);
        File out = new File(args[7]); out.mkdirs();
        int seconds = Integer.parseInt(args[6]);
        String[] events = args.length > 8 ? args[8].split(",") : new String[0];
        for (int s = 1; s <= seconds; s++) {
            Thread.sleep(1000);
            for (String ev : events) {
                String[] part = ev.split(":");
                if (Integer.parseInt(part[0]) == s) {
                    key(Integer.parseInt(part[1]), true); Thread.sleep(120); key(Integer.parseInt(part[1]), false);
                }
            }
            if (s % 5 == 0 || s == seconds) screenshot(new File(out, "frame-"+s+".png").toString());
        }
        System.out.println("PROBE " + getStatus());
        try (Writer trace = new OutputStreamWriter(new FileOutputStream(new File(out,"events.txt")),"UTF-8")) {
            trace.write(getLog());
        }
        System.exit(failure.length() > 0 ? 1 : 0);
    }
}
