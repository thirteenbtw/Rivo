package app.rivo.tv;

import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Handler;
import android.os.Looper;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.URL;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Finds Rivo servers on the local network two ways at once: the mDNS
 * announcement (_rivo._tcp, see server/internal/announce) and, because
 * multicast is often filtered by routers or Windows Firewall, a quick probe of
 * every address in the TV's /24 subnet on Rivo's ports. Both report through
 * {@link Listener} on the main thread.
 */
final class Discovery {

    static final class Server {
        final String url;   // http://192.168.1.10:8096
        final String name;  // PC name, or the address
        final String version;

        Server(String url, String name, String version) {
            this.url = url;
            this.name = name;
            this.version = version;
        }
    }

    interface Listener {
        void onFound(Server s);
        void onFinished();
    }

    private static final String SERVICE = "_rivo._tcp.";
    private static final int[] PORTS = {8096, 8097, 8098};

    private final Context ctx;
    private final Listener listener;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Set<String> seen = Collections.synchronizedSet(new HashSet<String>());
    private ExecutorService pool;
    private NsdManager nsd;
    private NsdManager.DiscoveryListener nsdListener;
    private WifiManager.MulticastLock lock;
    private volatile boolean stopped;

    Discovery(Context ctx, Listener listener) {
        this.ctx = ctx.getApplicationContext();
        this.listener = listener;
    }

    void start() {
        stopped = false;
        startNsd();
        startScan();
    }

    void stop() {
        stopped = true;
        if (pool != null) pool.shutdownNow();
        if (nsd != null && nsdListener != null) {
            try { nsd.stopServiceDiscovery(nsdListener); } catch (Exception ignored) { }
        }
        nsdListener = null;
        if (lock != null && lock.isHeld()) lock.release();
    }

    // ---------- mDNS ----------

    private void startNsd() {
        try {
            WifiManager wifi = (WifiManager) ctx.getSystemService(Context.WIFI_SERVICE);
            if (wifi != null) {
                lock = wifi.createMulticastLock("rivo");
                lock.setReferenceCounted(false);
                lock.acquire();
            }
        } catch (Exception ignored) { }
        nsd = (NsdManager) ctx.getSystemService(Context.NSD_SERVICE);
        if (nsd == null) return;
        nsdListener = new NsdManager.DiscoveryListener() {
            @Override public void onDiscoveryStarted(String type) { }
            @Override public void onDiscoveryStopped(String type) { }
            @Override public void onStartDiscoveryFailed(String type, int code) { }
            @Override public void onStopDiscoveryFailed(String type, int code) { }
            @Override public void onServiceLost(NsdServiceInfo info) { }

            @Override public void onServiceFound(NsdServiceInfo info) {
                // NsdManager resolves one service at a time; resolving on the
                // pool keeps a busy resolver from blocking the next one.
                resolve(info, 0);
            }
        };
        try {
            nsd.discoverServices(SERVICE, NsdManager.PROTOCOL_DNS_SD, nsdListener);
        } catch (Exception ignored) { }
    }

    private void resolve(final NsdServiceInfo info, final int attempt) {
        if (stopped || nsd == null) return;
        try {
            nsd.resolveService(info, new NsdManager.ResolveListener() {
                @Override public void onResolveFailed(NsdServiceInfo i, int code) {
                    // FAILURE_ALREADY_ACTIVE: another resolve is running; try again shortly.
                    if (attempt < 5) main.postDelayed(() -> resolve(info, attempt + 1), 400L * (attempt + 1));
                }

                @Override public void onServiceResolved(NsdServiceInfo i) {
                    InetAddress host = i.getHost();
                    if (host == null) return;
                    String ip = host.getHostAddress();
                    if (host instanceof java.net.Inet6Address) ip = "[" + ip + "]";
                    final String url = "http://" + ip + ":" + i.getPort();
                    Thread t = new Thread(() -> probe(url, 2500));
                    t.start();
                }
            });
        } catch (Exception ignored) { }
    }

    // ---------- subnet probe ----------

    private void startScan() {
        final List<String> prefixes = subnets();
        pool = Executors.newFixedThreadPool(48);
        final AtomicInteger left = new AtomicInteger(0);
        List<String> targets = new ArrayList<>();
        for (String p : prefixes) {
            for (int i = 1; i < 255; i++) {
                for (int port : PORTS) targets.add("http://" + p + i + ":" + port);
            }
        }
        if (targets.isEmpty()) {
            main.postDelayed(this::finish, 4000);
            return;
        }
        left.set(targets.size());
        // The usual port first across the whole subnet, the spare ones after.
        Collections.sort(targets, (a, b) -> Integer.compare(portOf(a), portOf(b)));
        for (final String url : targets) {
            pool.execute(() -> {
                if (!stopped) probe(url, 600);
                if (left.decrementAndGet() == 0) main.post(this::finish);
            });
        }
        pool.shutdown();
        // A safety net in case a probe hangs past its timeouts.
        new Thread(() -> {
            try { pool.awaitTermination(40, TimeUnit.SECONDS); } catch (InterruptedException ignored) { }
            main.post(this::finish);
        }).start();
    }

    private boolean finished;

    private void finish() {
        if (finished || stopped) return;
        finished = true;
        listener.onFinished();
    }

    private static int portOf(String url) {
        return Integer.parseInt(url.substring(url.lastIndexOf(':') + 1));
    }

    /** "192.168.1." for every private IPv4 address this TV has. */
    static List<String> subnets() {
        List<String> out = new ArrayList<>();
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                    if (!(a instanceof Inet4Address) || !a.isSiteLocalAddress()) continue;
                    String ip = a.getHostAddress();
                    String p = ip.substring(0, ip.lastIndexOf('.') + 1);
                    if (!out.contains(p)) out.add(p);
                }
            }
        } catch (Exception ignored) { }
        return out;
    }

    /** Asks url for /api/state and reports it when it is a Rivo server. */
    void probe(String url, int timeout) {
        if (seen.contains(url)) return;
        Server s = check(url, timeout);
        if (s == null || !seen.add(url)) return;
        main.post(() -> { if (!stopped) listener.onFound(s); });
    }

    static Server check(String url, int timeout) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(url + "/api/state").openConnection();
            c.setConnectTimeout(timeout);
            c.setReadTimeout(timeout * 3);
            c.setUseCaches(false);
            if (c.getResponseCode() != 200) return null;
            InputStream in = c.getInputStream();
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] b = new byte[4096];
            int n;
            while ((n = in.read(b)) > 0 && buf.size() < 256 * 1024) buf.write(b, 0, n);
            JSONObject j = new JSONObject(buf.toString("UTF-8"));
            // Older servers have no "app" field but always send lanUrls.
            if (!"rivo".equals(j.optString("app")) && !j.has("lanUrls")) return null;
            String host = j.optString("host", "");
            String name = host.isEmpty() ? url.replace("http://", "") : host;
            return new Server(url, name, j.optString("version", ""));
        } catch (Exception e) {
            return null;
        } finally {
            if (c != null) c.disconnect();
        }
    }
}
