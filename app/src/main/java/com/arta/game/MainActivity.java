package com.arta.game;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.pm.ActivityInfo;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {
    /** Страница игры переходит по этому адресу, когда готова перезапуститься на скачанную версию. */
    private static final String APPLY_URL = "arta://apply-update";

    private WebView web;
    private Updater.Active active;   // версия игры, открытая сейчас
    private Updater.Active pending;  // скачанная версия, ждущая применения

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (url.startsWith(APPLY_URL)) { applyPending(); return true; }
                // игра живёт только в локальных файлах; наружу не ходим
                return !url.startsWith("file://");
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (active == null) return;
                view.evaluateJavascript("window.onAppInfo && window.onAppInfo({ game: " + active.version
                        + ", app: " + BuildConfig.VERSION_CODE + ", bundled: " + active.bundled + " })", null);
                checkForUpdate();
            }
        });
        setContentView(web);
        hideSystemBars();
        open(Updater.resolve(this));
    }

    private void open(Updater.Active a) {
        active = a;
        pending = null;
        setRequestedOrientation("portrait".equals(a.orientation)
                ? ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
                : ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
        web.loadUrl(a.url);
    }

    private void checkForUpdate() {
        if (active == null) return;
        Updater.checkAsync(this, pending != null ? pending.version : active.version, next -> {
            if (isFinishing() || isDestroyed()) return;
            pending = next;
            // Спрашиваем игру, можно ли перезапуститься прямо сейчас (например, игрок в меню).
            // Если страница не отвечает на вопрос — считаем, что можно.
            web.evaluateJavascript("(function(){ try { return window.onUpdateReady ? !!window.onUpdateReady(" + next.version
                    + ") : true; } catch (e) { return true; } })()", value -> {
                if ("true".equals(value)) applyPending();
            });
        });
    }

    /** Переключиться на скачанную версию (если она есть и цела). */
    private void applyPending() {
        if (pending == null) return;
        Updater.Active a = Updater.resolve(this);
        if (a.version > active.version) open(a);
        else pending = null;
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
        web.evaluateJavascript("window.onAppPause && window.onAppPause()", null);
        web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        checkForUpdate();
    }

    @Override
    protected void onDestroy() {
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
