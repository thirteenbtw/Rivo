package app.rivo.server;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;

import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;

/**
 * Starts the server service and shows Rivo's own interface from it in a
 * WebView. Asks once for what the server needs: notifications (the
 * foreground notification), all-files access (library folders, Downloads)
 * and no battery optimisation (so Android does not stop it at night).
 */
public class MainActivity extends Activity {

    private static String local() { return "http://127.0.0.1:" + ServerService.port; }
    private final Handler main = new Handler(Looper.getMainLooper());
    private WebView web;
    private TextView status;
    private String pendingPath = "/";
    private boolean loaded;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFF141A33);
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if ("127.0.0.1".equals(u.getHost())) return false;
                // External links (trailers, TMDB) open in the browser.
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
                return true;
            }
        });
        web.setVisibility(View.INVISIBLE);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        status = new TextView(this);
        status.setTextColor(0xFFE7ECF7);
        status.setTextSize(18);
        status.setGravity(Gravity.CENTER);
        status.setPadding(40, 40, 40, 40);
        status.setTextIsSelectable(true);
        status.setText("Запускаем сервер…");
        root.addView(status, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);

        handle(getIntent());
        askPermissions();
        startService();
        waitReady(0);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handle(intent);
        if (loaded) web.loadUrl(local() + pendingPath);
    }

    // magnet: links open the server's torrent page with the link filled in.
    private void handle(Intent i) {
        Uri u = i == null ? null : i.getData();
        if (u != null && "magnet".equals(u.getScheme())) {
            try { pendingPath = "/torrents?magnet=" + URLEncoder.encode(u.toString(), "UTF-8"); } catch (Exception ignored) { }
        }
    }

    private void startService() {
        Intent i = new Intent(this, ServerService.class);
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(i); else startService(i);
    }

    // Polls the server until it answers, then loads the interface.
    private void waitReady(final int attempt) {
        new Thread(() -> {
            boolean ok = false;
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(local() + "/api/state").openConnection();
                c.setConnectTimeout(800);
                c.setReadTimeout(1500);
                ok = c.getResponseCode() == 200;
                c.disconnect();
            } catch (Exception ignored) { }
            final boolean ready = ok;
            main.post(() -> {
                if (isFinishing()) return;
                String fail = ServerService.failure;
                if (ready) {
                    loaded = true;
                    web.loadUrl(local() + pendingPath);
                    web.setVisibility(View.VISIBLE);
                    status.setVisibility(View.GONE);
                } else if (fail != null && attempt > 2) {
                    status.setText(fail + "\n\n" + ServerService.tail() + "\n\nПерезапустите приложение.");
                } else if (attempt < 240) {
                    if (attempt >= 20) status.setText("Сервер запускается дольше обычного…\n\n" + ServerService.tail());
                    main.postDelayed(() -> waitReady(attempt + 1), 500);
                } else {
                    status.setText("Сервер не ответил за 2 минуты.\n\n" + ServerService.tail());
                }
            });
        }).start();
    }

    static boolean hasStorage(Context c) {
        if (Build.VERSION.SDK_INT >= 30) return Environment.isExternalStorageManager();
        return c.checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED;
    }

    private void askPermissions() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1);
        }
        if (!hasStorage(this)) {
            if (Build.VERSION.SDK_INT >= 30) {
                new AlertDialog.Builder(this)
                        .setTitle("Доступ к файлам")
                        .setMessage("Rivo нужен доступ к файлам, чтобы показывать ваши фильмы и сохранять торренты в «Загрузки/Rivo».")
                        .setPositiveButton("Разрешить", (d, w) -> {
                            try {
                                startActivity(new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:" + getPackageName())));
                            } catch (Exception e) {
                                startActivity(new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION));
                            }
                        })
                        .setNegativeButton("Не сейчас", null)
                        .show();
            } else if (Build.VERSION.SDK_INT >= 23) {
                requestPermissions(new String[]{Manifest.permission.READ_EXTERNAL_STORAGE, Manifest.permission.WRITE_EXTERNAL_STORAGE}, 2);
            }
        }
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        if (Build.VERSION.SDK_INT >= 23 && !pm.isIgnoringBatteryOptimizations(getPackageName())) {
            try {
                @SuppressLint("BatteryLife")
                Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getPackageName()));
                startActivity(i);
            } catch (Exception ignored) { }
        }
    }

    private boolean hadStorage;

    @Override
    protected void onResume() {
        super.onResume();
        // All-files access granted in Settings: restart the server so that
        // torrents go to Downloads/Rivo.
        boolean has = hasStorage(this);
        if (has && !hadStorage && ServerService.running && loaded) {
            stopService(new Intent(this, ServerService.class));
            loaded = false;
            web.setVisibility(View.INVISIBLE);
            status.setVisibility(View.VISIBLE);
            status.setText("Перезапускаем сервер…");
            main.postDelayed(() -> { startService(); waitReady(0); }, 1500);
        }
        hadStorage = has;
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else moveTaskToBack(true); // the server keeps running in the background
    }
}
