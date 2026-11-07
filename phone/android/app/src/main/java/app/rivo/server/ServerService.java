package app.rivo.server;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Environment;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;

/**
 * Runs the Rivo Go server (shipped as lib/arm64-v8a/librivo.so) as a child
 * process while a foreground notification keeps Android from killing it.
 * ffmpeg and ffprobe come the same way (libffmpeg.so, libffprobe.so):
 * nativeLibraryDir is the one app directory Android lets an app execute
 * files from.
 */
public class ServerService extends Service {

    static final String ACTION_STOP = "app.rivo.server.STOP";
    static final int PORT = 8096;
    private static final String TAG = "RivoServer";
    private static final String CHANNEL = "server";
    private static final int NOTE_ID = 1;

    /** True while the server process is alive; read by the activity. */
    static volatile boolean running;

    private Process proc;
    private PowerManager.WakeLock wake;
    private WifiManager.WifiLock wifi;
    private WifiManager.MulticastLock multicast;

    @Override
    public IBinder onBind(Intent intent) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopServer();
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }
        Notification n = notification(getString(R.string.app_name) + " запускается…");
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTE_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(NOTE_ID, n);
        }
        if (proc == null) startServer();
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        stopServer();
        super.onDestroy();
    }

    private void startServer() {
        String lib = getApplicationInfo().nativeLibraryDir;
        File data = new File(getFilesDir(), "rivo");
        //noinspection ResultOfMethodCallIgnored
        data.mkdirs();
        List<String> cmd = new ArrayList<>();
        cmd.add(lib + "/librivo.so");
        Collections.addAll(cmd,
                "-data", data.getAbsolutePath(),
                "-ffmpeg", lib + "/libffmpeg.so",
                "-ffprobe", lib + "/libffprobe.so",
                "-listen", "0.0.0.0:" + PORT,
                "-exit-on-stdin-close");
        ProcessBuilder pb = new ProcessBuilder(cmd);
        pb.redirectErrorStream(true);
        pb.directory(data);
        Map<String, String> env = pb.environment();
        env.put("HOME", data.getAbsolutePath());
        env.put("TMPDIR", getCacheDir().getAbsolutePath());
        if (MainActivity.hasStorage(this)) {
            File dl = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "Rivo");
            //noinspection ResultOfMethodCallIgnored
            dl.mkdirs();
            env.put("RIVO_DOWNLOAD_DIR", dl.getAbsolutePath());
        }
        try {
            proc = pb.start();
        } catch (Exception e) {
            Log.e(TAG, "start", e);
            update("Не удалось запустить сервер: " + e.getMessage());
            stopSelf();
            return;
        }
        running = true;
        acquireLocks();
        final Process p = proc;
        final File log = new File(data, "server-console.log");
        new Thread(() -> pump(p, log), "rivo-log").start();
        new Thread(() -> {
            int code = -1;
            try { code = p.waitFor(); } catch (InterruptedException ignored) { }
            if (p == proc) {
                running = false;
                proc = null;
                releaseLocks();
                update("Сервер остановился (код " + code + ")");
                stopSelf();
            }
        }, "rivo-wait").start();
        update("Работает · " + address());
    }

    // Copies the server's output to a log file (and logcat) until it exits.
    private static void pump(Process p, File log) {
        byte[] buf = new byte[8192];
        try (InputStream in = p.getInputStream(); OutputStream out = new FileOutputStream(log, false)) {
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
                out.flush();
                Log.i(TAG, new String(buf, 0, n).trim());
            }
        } catch (Exception ignored) { }
    }

    private void stopServer() {
        Process p = proc;
        proc = null;
        running = false;
        if (p != null) {
            // Closing stdin asks the server to shut down cleanly
            // (-exit-on-stdin-close); kill it if it does not.
            try { p.getOutputStream().close(); } catch (Exception ignored) { }
            try {
                if (Build.VERSION.SDK_INT >= 26 && !p.waitFor(5, java.util.concurrent.TimeUnit.SECONDS)) p.destroy();
                else if (Build.VERSION.SDK_INT < 26) p.destroy();
            } catch (InterruptedException e) { p.destroy(); }
        }
        releaseLocks();
    }

    private void acquireLocks() {
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "rivo:server");
        wake.acquire();
        WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        if (wm != null) {
            wifi = wm.createWifiLock(Build.VERSION.SDK_INT >= 29 ? WifiManager.WIFI_MODE_FULL_LOW_LATENCY : WifiManager.WIFI_MODE_FULL_HIGH_PERF, "rivo:wifi");
            wifi.acquire();
            // mDNS: lets TVs find the server and the server find Chromecasts.
            multicast = wm.createMulticastLock("rivo:mdns");
            multicast.setReferenceCounted(false);
            multicast.acquire();
        }
    }

    private void releaseLocks() {
        if (wake != null && wake.isHeld()) wake.release();
        if (wifi != null && wifi.isHeld()) wifi.release();
        if (multicast != null && multicast.isHeld()) multicast.release();
        wake = null; wifi = null; multicast = null;
    }

    /** The phone's LAN address for TVs, e.g. http://192.168.1.5:8096. */
    static String address() {
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                String name = ni.getName();
                if (name.startsWith("tun") || name.startsWith("ppp") || name.startsWith("rmnet")) continue;
                for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                    if (a instanceof Inet4Address && a.isSiteLocalAddress()) {
                        return "http://" + a.getHostAddress() + ":" + PORT;
                    }
                }
            }
        } catch (Exception ignored) { }
        return "http://127.0.0.1:" + PORT;
    }

    private void update(String text) {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        nm.notify(NOTE_ID, notification(text));
    }

    private Notification notification(String text) {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Сервер", NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        int immutable = Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0;
        PendingIntent open = PendingIntent.getActivity(this, 0,
                new Intent(this, MainActivity.class), immutable | PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent stop = PendingIntent.getService(this, 1,
                new Intent(this, ServerService.class).setAction(ACTION_STOP), immutable | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        b.setSmallIcon(android.R.drawable.ic_media_play)
                .setContentTitle(getString(R.string.app_name))
                .setContentText(text)
                .setContentIntent(open)
                .setOngoing(true)
                .addAction(new Notification.Action.Builder(android.R.drawable.ic_menu_close_clear_cancel, "Остановить", stop).build());
        return b.build();
    }
}
