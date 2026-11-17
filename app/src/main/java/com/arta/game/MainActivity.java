package com.arta.game;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.pm.ActivityInfo;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {
    /** Страница без обработчика onUpdateReady перезапускается на новую версию, только если открылась недавно. */
    private static final long FRESH_PAGE_MS = 20_000;
    /** Через сколько после загрузки страницы версия без явного подтверждения считается рабочей. */
    private static final long IMPLICIT_CONFIRM_MS = 8_000;
    private static final long POLL_MS = 2 * 60 * 1000 + 5_000;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private WebView web;
    private Updater.Active active;   // версия игры, открытая сейчас
    private Updater.Active pending;  // скачанная версия, ждущая применения
    private boolean applyOnResume;   // применить pending при следующем возврате в приложение
    private boolean resumed;
    private long pageLoadedAt;
    private int renderCrashes;

    private final Runnable implicitConfirm = () -> Updater.confirmBoot(this, active);
    private final Runnable poll = new Runnable() {
        @Override public void run() {
            checkForUpdate();
            if (resumed) handler.postDelayed(this, POLL_MS);
        }
    };

    /** Мост «игра → приложение». Методы вызываются из потока WebView, поэтому работа уходит в главный поток. */
    private final class Bridge {
        /** Игра запустилась и работает: скачанную версию можно считать исправной. */
        @JavascriptInterface public void ready() {
            handler.post(() -> { handler.removeCallbacks(implicitConfirm); Updater.confirmBoot(MainActivity.this, active); });
        }
        /** Игра готова перезапуститься на скачанное обновление (например, игрок вышел в меню). */
        @JavascriptInterface public void applyUpdate() { handler.post(MainActivity.this::applyPending); }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        createWebView();
        open(Updater.resolve(this, 0));
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void createWebView() {
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.addJavascriptInterface(new Bridge(), "ArtaNative");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // игра живёт только в локальных файлах; наружу не ходим
                return !request.getUrl().toString().startsWith("file://");
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (active == null || view != web) return;
                pageLoadedAt = SystemClock.elapsedRealtime();
                String info = "{ game: " + active.version + ", app: " + BuildConfig.VERSION_CODE + ", bundled: " + active.bundled + " }";
                view.evaluateJavascript("window.__appInfo = " + info + "; window.onAppInfo && window.onAppInfo(window.__appInfo);", null);
                handler.removeCallbacks(implicitConfirm);
                if (!active.bundled && !active.confirm) handler.postDelayed(implicitConfirm, IMPLICIT_CONFIRM_MS);
                checkForUpdate();
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                // Процесс отрисовки упал (или убит системой). Пересоздаём WebView; если скачанная версия
                // не успела подтвердить запуск, Updater после второй неудачи вернёт встроенную.
                handler.removeCallbacks(implicitConfirm);
                if (view.getParent() instanceof ViewGroup) ((ViewGroup) view.getParent()).removeView(view);
                view.destroy();
                if (view != web) return true;
                if (++renderCrashes > 3 || isFinishing()) { finish(); return true; }
                createWebView();
                open(Updater.resolve(MainActivity.this, 0));
                return true;
            }
        });
        setContentView(web);
        hideSystemBars();
    }

    private void open(Updater.Active a) {
        active = a;
        pending = null;
        applyOnResume = false;
        handler.removeCallbacks(implicitConfirm);
        Updater.noteBootAttempt(this, a);
        setRequestedOrientation("portrait".equals(a.orientation)
                ? ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
                : ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
        web.loadUrl(a.url);
    }

    private void checkForUpdate() {
        if (active == null) return;
        if (pending == null) {
            Updater.Active r = Updater.readyNewerThan(active.version); // скачано, пока Activity не было
            if (r != null) { onUpdateReady(r); return; }
        }
        Updater.checkAsync(this, pending != null ? pending.version : active.version);
    }

    private void onUpdateReady(Updater.Active next) {
        if (isFinishing() || isDestroyed() || active == null || next.version <= active.version) return;
        if (pending != null && pending.version >= next.version) return;
        pending = next;
        // Спрашиваем игру, можно ли перезапуститься прямо сейчас (например, игрок в меню).
        web.evaluateJavascript("(function(){ try { return window.onUpdateReady ? !!window.onUpdateReady(" + next.version
                + ") : null; } catch (e) { return null; } })()", value -> {
            if ("true".equals(value)) applyPending();
            else if ("false".equals(value)) { /* игра сама вызовет ArtaNative.applyUpdate(), когда будет готова */ }
            else if (SystemClock.elapsedRealtime() - pageLoadedAt < FRESH_PAGE_MS) applyPending();
            else applyOnResume = true; // старая игра без обработчика: не рвём бой, применим при возврате в приложение
        });
    }

    /** Переключиться на скачанную версию (если она есть и цела). */
    private void applyPending() {
        if (pending == null || active == null) return;
        Updater.Active a = Updater.resolve(this, active.version);
        if (a.version > active.version) open(a);
        else { pending = null; applyOnResume = false; }
    }

    /** Полноэкранный режим: прячем системные панели, они возвращаются свайпом от края. */
    @SuppressWarnings("deprecation")
    private void hideSystemBars() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    @Override
    protected void onPause() {
        super.onPause();
        resumed = false;
        handler.removeCallbacks(poll);
        Updater.setListener(null);
        web.evaluateJavascript("window.onAppPause && window.onAppPause()", null);
        web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        resumed = true;
        web.onResume();
        Updater.setListener(this::onUpdateReady);
        if (applyOnResume && pending != null) applyPending();
        handler.removeCallbacks(poll);
        handler.post(poll); // проверка сразу и далее каждые пару минут, пока приложение на экране
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        Updater.setListener(null);
        if (web.getParent() instanceof ViewGroup) ((ViewGroup) web.getParent()).removeView(web);
        web.destroy();
        super.onDestroy();
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        // Игра сама решает, что делать с кнопкой «Назад».
        web.evaluateJavascript("window.onBackButton ? window.onBackButton() : false", value -> {
            if (!"true".equals(value)) MainActivity.super.onBackPressed();
        });
    }
}
