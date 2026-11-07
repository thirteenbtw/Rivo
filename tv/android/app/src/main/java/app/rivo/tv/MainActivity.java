package app.rivo.tv;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.StateListDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.List;

/**
 * Rivo for Android TV: finds the PC running Rivo on the home network and
 * opens its interface full screen in TV mode (remote navigation, Back and
 * media keys; see web/src/tv.ts). The video plays in the WebView; the PC
 * transcodes whatever the TV can't decode.
 */
public class MainActivity extends Activity implements Discovery.Listener {

    private static final String PREFS = "rivo";
    private static final String KEY_URL = "server";
    private static final String KEY_NAME = "serverName";

    // Rivo palette (desktop/app-icon.svg, web/src/styles.css).
    private static final int NIGHT = 0xFF141A33, CARD = 0xFF252D51, LINE = 0xFF353E68,
            ICE = 0xFFE7ECF7, MUTED = 0xFF9AA3C7, IRIS = 0xFF5B6EE1, LAV = 0xFFA5B4FC;

    private final Handler main = new Handler(Looper.getMainLooper());
    private FrameLayout root;
    private WebView web;
    private View connect;
    private LinearLayout list;
    private TextView status;
    private EditText manual;
    private Discovery discovery;
    private final List<Discovery.Server> found = new ArrayList<>();
    private String failedUrl;
    private View customView;
    private boolean pageOk;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        root = new FrameLayout(this);
        root.setBackgroundColor(NIGHT);
        setContentView(root);
        immersive();

        String saved = prefs().getString(KEY_URL, null);
        if (saved != null) open(saved);
        else showConnect(null);
    }

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private int dp(float v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }

    private void immersive() {
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) immersive();
    }

    // ---------- the Rivo interface ----------

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void open(String url) {
        stopDiscovery();
        if (connect != null) { root.removeView(connect); connect = null; }
        if (web == null) {
            web = new WebView(this);
            web.setBackgroundColor(NIGHT);
            WebSettings s = web.getSettings();
            s.setJavaScriptEnabled(true);
            s.setDomStorageEnabled(true);
            s.setMediaPlaybackRequiresUserGesture(false);
            s.setLoadWithOverviewMode(true);
            s.setUseWideViewPort(true);
            s.setSupportZoom(false);
            s.setUserAgentString(s.getUserAgentString() + " Rivo-TV/" + version() + " (Android TV)");
            if (Build.VERSION.SDK_INT >= 21) CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);
            web.addJavascriptInterface(new Bridge(), "RivoTV");
            web.setWebViewClient(new Client());
            web.setWebChromeClient(new Chrome());
            root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        }
        web.setVisibility(View.VISIBLE);
        pageOk = false;
        failedUrl = null;
        web.loadUrl(url + "/?tv=1");
        web.requestFocus();
    }

    private final class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
            return false;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            if (failedUrl == null) pageOk = true;
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
            if (Build.VERSION.SDK_INT >= 23 && req.isForMainFrame()) failed();
        }

        @SuppressWarnings("deprecation")
        @Override
        public void onReceivedError(WebView view, int code, String description, String url) {
            if (Build.VERSION.SDK_INT < 23) failed();
        }
    }

    // The PC is off, asleep or got a new address: look for it again.
    private void failed() {
        failedUrl = prefs().getString(KEY_URL, "");
        main.post(() -> {
            if (web != null) { web.stopLoading(); web.setVisibility(View.GONE); }
            showConnect(failedUrl);
        });
    }

    private final class Chrome extends WebChromeClient {
        // Without this WebView draws a grey play icon over every video before it starts.
        @Override
        public Bitmap getDefaultVideoPoster() {
            return Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888);
        }

        @Override
        public void onShowCustomView(View view, CustomViewCallback callback) {
            if (customView != null) { callback.onCustomViewHidden(); return; }
            customView = view;
            root.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        }

        @Override
        public void onHideCustomView() {
            if (customView == null) return;
            root.removeView(customView);
            customView = null;
        }
    }

    /** window.RivoTV in the page (web/src/tv.ts). */
    private final class Bridge {
        @JavascriptInterface public void exit() { main.post(MainActivity.this::finish); }

        @JavascriptInterface public void changeServer() {
            main.post(() -> {
                if (web != null) web.setVisibility(View.GONE);
                showConnect(null);
            });
        }

        @JavascriptInterface public String server() {
            String name = prefs().getString(KEY_NAME, "");
            String url = prefs().getString(KEY_URL, "");
            return name.isEmpty() ? url : name + " · " + url.replace("http://", "");
        }

        @JavascriptInterface public String version() { return MainActivity.this.version(); }

        @JavascriptInterface public void keepAwake(boolean on) {
            main.post(() -> {
                if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            });
        }
    }

    private String version() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "";
        }
    }

    private boolean webShown() {
        return web != null && web.getVisibility() == View.VISIBLE && connect == null;
    }

    // ---------- remote keys ----------

    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        if (!webShown()) return super.dispatchKeyEvent(e);
        int code = e.getKeyCode();
        if (code == KeyEvent.KEYCODE_BACK) {
            if (e.getAction() == KeyEvent.ACTION_UP) back();
            return true;
        }
        String key = mediaKey(code);
        if (key != null) {
            if (e.getAction() == KeyEvent.ACTION_DOWN && e.getRepeatCount() == 0) {
                web.evaluateJavascript("window.rivoTvKey && window.rivoTvKey('" + key + "')", null);
            }
            return true;
        }
        return super.dispatchKeyEvent(e);
    }

    private static String mediaKey(int code) {
        switch (code) {
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE: return "MediaPlayPause";
            case KeyEvent.KEYCODE_MEDIA_PLAY: return "MediaPlay";
            case KeyEvent.KEYCODE_MEDIA_PAUSE: return "MediaPause";
            case KeyEvent.KEYCODE_MEDIA_STOP: return "MediaStop";
            case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD: return "MediaFastForward";
            case KeyEvent.KEYCODE_MEDIA_REWIND: return "MediaRewind";
            case KeyEvent.KEYCODE_MEDIA_NEXT: return "MediaTrackNext";
            case KeyEvent.KEYCODE_MEDIA_PREVIOUS: return "MediaTrackPrevious";
            default: return null;
        }
    }

    // Back closes what is open in Rivo first; on Home it leaves the app.
    private void back() {
        if (customView != null) { root.removeView(customView); customView = null; return; }
        if (!pageOk) { finish(); return; }
        web.evaluateJavascript("window.rivoTvBack ? window.rivoTvBack() : 'none'", r -> {
            if ("\"exit\"".equals(r)) finish();
            else if (!"\"handled\"".equals(r)) {
                if (web.canGoBack()) web.goBack(); else finish();
            }
        });
    }

    // ---------- connect screen ----------

    private void showConnect(String unreachable) {
        if (connect != null) root.removeView(connect);
        found.clear();

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setGravity(Gravity.CENTER_HORIZONTAL);
        col.setPadding(dp(64), dp(40), dp(64), dp(40));
        scroll.addView(col);

        TextView logo = text("rıvo", 44, ICE, true);
        logo.setLetterSpacing(-0.02f);
        col.addView(logo);

        TextView title = text(unreachable != null ? "Компьютер не отвечает" : "Подключение к компьютеру", 22, ICE, true);
        title.setPadding(0, dp(12), 0, dp(4));
        col.addView(title);

        String hint = unreachable != null
                ? "Не удаётся открыть " + unreachable.replace("http://", "") + ". Проверьте, что Rivo запущен на ПК и он в той же сети. Ищем снова…"
                : "Rivo должен быть запущен на ПК в той же сети, что и телевизор.";
        TextView sub = text(hint, 15, MUTED, false);
        sub.setGravity(Gravity.CENTER);
        sub.setMaxWidth(dp(560));
        col.addView(sub);

        status = text("Ищем Rivo в сети…", 14, LAV, false);
        status.setPadding(0, dp(20), 0, dp(8));
        col.addView(status);

        list = new LinearLayout(this);
        list.setOrientation(LinearLayout.VERTICAL);
        col.addView(list, new LinearLayout.LayoutParams(dp(480), ViewGroup.LayoutParams.WRAP_CONTENT));

        if (unreachable != null) {
            Button retry = button("Повторить: " + nameOr(unreachable), true);
            retry.setOnClickListener(v -> open(unreachable));
            list.addView(retry, rowParams());
        }

        TextView or = text("или введите адрес, который показан в Rivo на ПК (Настройки → Сеть)", 13, MUTED, false);
        or.setGravity(Gravity.CENTER);
        or.setPadding(0, dp(24), 0, dp(8));
        or.setMaxWidth(dp(520));
        col.addView(or);

        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        manual = new EditText(this);
        manual.setSingleLine(true);
        manual.setHint("192.168.1.10:8096");
        manual.setHintTextColor(0xFF5D6690);
        manual.setTextColor(ICE);
        manual.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        manual.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        manual.setImeOptions(EditorInfo.IME_ACTION_GO);
        manual.setBackground(box(CARD, LINE, 2));
        manual.setPadding(dp(16), 0, dp(16), 0);
        String last = prefs().getString(KEY_URL, "");
        if (!last.isEmpty()) manual.setText(last.replace("http://", ""));
        manual.setOnEditorActionListener((v, id, ev) -> { connectManual(); return true; });
        row.addView(manual, new LinearLayout.LayoutParams(0, dp(52), 1));
        Button go = button("Подключить", false);
        go.setOnClickListener(v -> connectManual());
        LinearLayout.LayoutParams gp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(52));
        gp.leftMargin = dp(10);
        row.addView(go, gp);
        col.addView(row, new LinearLayout.LayoutParams(dp(480), ViewGroup.LayoutParams.WRAP_CONTENT));

        Button again = button("Искать снова", false);
        again.setOnClickListener(v -> showConnect(null));
        LinearLayout.LayoutParams ap = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(48));
        ap.topMargin = dp(16);
        col.addView(again, ap);

        connect = scroll;
        root.addView(connect, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        (list.getChildCount() > 0 ? list.getChildAt(0) : again).requestFocus();

        stopDiscovery();
        discovery = new Discovery(this, this);
        discovery.start();
    }

    private String nameOr(String url) {
        String name = prefs().getString(KEY_NAME, "");
        return name.isEmpty() ? url.replace("http://", "") : name;
    }

    private void connectManual() {
        String v = manual.getText().toString().trim();
        if (v.isEmpty()) return;
        InputMethodManager imm = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
        if (imm != null) imm.hideSoftInputFromWindow(manual.getWindowToken(), 0);
        if (!v.startsWith("http://") && !v.startsWith("https://")) v = "http://" + v;
        Uri u = Uri.parse(v);
        if (u.getHost() == null) { status.setText("Не похоже на адрес. Пример: 192.168.1.10:8096"); return; }
        final String url = u.getScheme() + "://" + u.getHost() + ":" + (u.getPort() > 0 ? u.getPort() : 8096);
        status.setText("Проверяем " + url.replace("http://", "") + "…");
        new Thread(() -> {
            Discovery.Server s = Discovery.check(url, 3000);
            main.post(() -> {
                if (s != null) choose(s);
                else if (status != null) status.setText("Rivo не ответил на " + url.replace("http://", "") + ". Проверьте адрес и что ПК в той же сети.");
            });
        }).start();
    }

    @Override
    public void onFound(Discovery.Server s) {
        if (connect == null) return;
        for (Discovery.Server x : found) if (x.url.equals(s.url)) return;
        found.add(s);
        // The PC we used before, maybe at a new address: go straight back to it.
        String lastName = prefs().getString(KEY_NAME, "");
        String lastUrl = prefs().getString(KEY_URL, "");
        if (failedUrl != null && !lastName.isEmpty() && lastName.equals(s.name) && !lastUrl.equals(s.url)) {
            choose(s);
            return;
        }
        Button b = button(s.name + "   " + s.url.replace("http://", ""), found.size() == 1);
        b.setOnClickListener(v -> choose(s));
        list.addView(b, rowParams());
        status.setText(found.size() == 1 ? "Найден компьютер с Rivo:" : "Найдены компьютеры с Rivo:");
        if (found.size() == 1 && failedUrl == null) b.requestFocus();
    }

    @Override
    public void onFinished() {
        if (connect == null || status == null) return;
        if (found.isEmpty()) {
            status.setText("Rivo в сети не найден. Введите адрес вручную или запустите Rivo на ПК и нажмите «Искать снова».");
        } else if (found.size() == 1 && prefs().getString(KEY_URL, null) == null) {
            // First start and exactly one PC: no need to ask.
            choose(found.get(0));
        }
    }

    private void choose(Discovery.Server s) {
        prefs().edit().putString(KEY_URL, s.url).putString(KEY_NAME, s.name).apply();
        open(s.url);
    }

    private void stopDiscovery() {
        if (discovery != null) { discovery.stop(); discovery = null; }
    }

    @Override
    protected void onDestroy() {
        stopDiscovery();
        if (web != null) web.destroy();
        super.onDestroy();
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (web != null) web.evaluateJavascript("document.querySelectorAll('video').forEach(function(v){v.pause()})", null);
    }

    // ---------- small view helpers ----------

    private TextView text(String s, float sp, int color, boolean bold) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(color);
        if (bold) t.setTypeface(Typeface.create("sans-serif", Typeface.BOLD));
        t.setGravity(Gravity.CENTER_HORIZONTAL);
        return t;
    }

    private GradientDrawable box(int fill, int stroke, int strokeDp) {
        GradientDrawable d = new GradientDrawable();
        d.setColor(fill);
        d.setCornerRadius(dp(14));
        if (strokeDp > 0) d.setStroke(dp(strokeDp), stroke);
        return d;
    }

    // Big remote-friendly buttons: the focused one turns Iris with a light ring.
    private Button button(String label, boolean primary) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        b.setTextColor(ICE);
        b.setPadding(dp(22), 0, dp(22), 0);
        b.setFocusable(true);
        StateListDrawable bg = new StateListDrawable();
        bg.addState(new int[]{android.R.attr.state_focused}, box(IRIS, Color.WHITE, 3));
        bg.addState(new int[]{android.R.attr.state_pressed}, box(IRIS, IRIS, 0));
        bg.addState(new int[]{}, box(primary ? 0xFF3A4580 : CARD, LINE, 1));
        b.setBackground(bg);
        if (Build.VERSION.SDK_INT >= 21) b.setStateListAnimator(null);
        return b;
    }

    private LinearLayout.LayoutParams rowParams() {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(56));
        p.topMargin = dp(8);
        return p;
    }
}
