package com.gd3d.editor;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.TextView;
import android.widget.Toast;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

public class MainActivity extends Activity {
    private static final String TAG = "GD3D";
    private static final int REQ_SAVE_TEXT = 7001;
    private static final int REQ_FILE_CHOOSER = 7002;
    private static final int EDITOR_PARTS = 9;

    private WebView webView;
    private ValueCallback<Uri[]> fileChooserCallback;
    private PendingSave pendingSave;

    private static class PendingSave {
        final String filename;
        final String mime;
        final String text;
        PendingSave(String filename, String mime, String text) {
            this.filename = filename;
            this.mime = mime;
            this.text = text;
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        try {
            requestWindowFeature(Window.FEATURE_NO_TITLE);
            getWindow().setFlags(
                    WindowManager.LayoutParams.FLAG_FULLSCREEN,
                    WindowManager.LayoutParams.FLAG_FULLSCREEN);

            webView = new WebView(this);
            setContentView(webView);
            enterImmersive();

            WebSettings s = webView.getSettings();
            s.setJavaScriptEnabled(true);
            s.setDomStorageEnabled(true);
            s.setAllowFileAccess(true);
            s.setAllowContentAccess(true);
            s.setDatabaseEnabled(true);
            s.setMediaPlaybackRequiresUserGesture(false);
            s.setBuiltInZoomControls(false);
            s.setDisplayZoomControls(false);
            s.setSupportZoom(false);
            s.setCacheMode(WebSettings.LOAD_DEFAULT);

            webView.setWebViewClient(new WebViewClient() {
                @Override
                public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                    Log.e(TAG, "WebView renderer exited. didCrash=" + detail.didCrash());
                    runOnUiThread(() -> showStartupError(
                            "Android System WebView stopped while GD3D was starting.\n\n" +
                            "Try updating Chrome / Android System WebView, then reopen GD3D."));
                    return true;
                }
            });

            webView.setWebChromeClient(new WebChromeClient() {
                @Override
                public boolean onShowFileChooser(WebView webView,
                                                 ValueCallback<Uri[]> filePathCallback,
                                                 FileChooserParams fileChooserParams) {
                    if (fileChooserCallback != null) fileChooserCallback.onReceiveValue(null);
                    fileChooserCallback = filePathCallback;
                    Intent intent;
                    try {
                        intent = fileChooserParams.createIntent();
                    } catch (Exception e) {
                        intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                        intent.addCategory(Intent.CATEGORY_OPENABLE);
                        intent.setType("*/*");
                    }
                    try {
                        startActivityForResult(intent, REQ_FILE_CHOOSER);
                        return true;
                    } catch (Exception e) {
                        fileChooserCallback.onReceiveValue(null);
                        fileChooserCallback = null;
                        Toast.makeText(MainActivity.this, "No file picker available", Toast.LENGTH_SHORT).show();
                        return false;
                    }
                }
            });

            AndroidBridge bridge = new AndroidBridge();
            webView.addJavascriptInterface(bridge, "GD3DAndroid");
            webView.addJavascriptInterface(bridge, "AndroidBridge");
            loadBundledEditor();
        } catch (Throwable t) {
            Log.e(TAG, "Fatal startup error", t);
            showStartupError("GD3D could not start.\n\n" + t.getClass().getSimpleName() +
                    (t.getMessage() == null ? "" : ": " + t.getMessage()));
        }
    }

    private void loadBundledEditor() {
        try {
            StringBuilder html = new StringBuilder(128 * 1024);
            byte[] buffer = new byte[8192];
            for (int i = 1; i <= EDITOR_PARTS; i++) {
                String name = String.format(Locale.US, "index.part%02d.html", i);
                try (InputStream in = getAssets().open(name);
                     ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                    int n;
                    while ((n = in.read(buffer)) != -1) out.write(buffer, 0, n);
                    html.append(out.toString(StandardCharsets.UTF_8.name()));
                }
            }
            webView.loadDataWithBaseURL(
                    "file:///android_asset/",
                    html.toString(),
                    "text/html",
                    "UTF-8",
                    null);
        } catch (Throwable t) {
            Log.e(TAG, "Unable to load bundled editor", t);
            showStartupError("GD3D editor assets could not be loaded.\n\n" +
                    t.getClass().getSimpleName() +
                    (t.getMessage() == null ? "" : ": " + t.getMessage()));
        }
    }

    private void showStartupError(String message) {
        try {
            if (webView != null) {
                try { webView.destroy(); } catch (Throwable ignored) {}
                webView = null;
            }
            TextView errorView = new TextView(this);
            errorView.setText(message + "\n\nBuild: GD3D 0.82.0-alpha");
            errorView.setTextSize(16f);
            errorView.setTextColor(0xFFFFFFFF);
            errorView.setBackgroundColor(0xFF101217);
            int pad = (int) (24 * getResources().getDisplayMetrics().density);
            errorView.setPadding(pad, pad, pad, pad);
            errorView.setTextIsSelectable(true);
            setContentView(errorView);
        } catch (Throwable ignored) {}
    }

    private void enterImmersive() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN |
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION |
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY |
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN |
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION |
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            try { enterImmersive(); } catch (Throwable ignored) {}
        }
    }

    public class AndroidBridge {
        @JavascriptInterface
        public void saveText(String filename, String mimeType, String text) {
            runOnUiThread(() -> launchSave(filename, mimeType, text));
        }

        @JavascriptInterface
        public String appVersion() {
            return "0.82.0-alpha";
        }

        @JavascriptInterface
        public void toast(String message) {
            runOnUiThread(() -> Toast.makeText(MainActivity.this, message, Toast.LENGTH_SHORT).show());
        }
    }

    private void launchSave(String filename, String mimeType, String text) {
        pendingSave = new PendingSave(
                filename == null || filename.isEmpty() ? "GD3D_export.txt" : filename,
                mimeType == null || mimeType.isEmpty() ? "text/plain" : mimeType,
                text == null ? "" : text);

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(pendingSave.mime);
        intent.putExtra(Intent.EXTRA_TITLE, pendingSave.filename);
        try {
            startActivityForResult(intent, REQ_SAVE_TEXT);
        } catch (Exception e) {
            Toast.makeText(this, "Unable to open Android save dialog", Toast.LENGTH_LONG).show();
            pendingSave = null;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_FILE_CHOOSER) {
            if (fileChooserCallback != null) {
                Uri[] result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
                fileChooserCallback.onReceiveValue(result);
                fileChooserCallback = null;
            }
            return;
        }
        if (requestCode == REQ_SAVE_TEXT) {
            PendingSave save = pendingSave;
            pendingSave = null;
            if (resultCode != RESULT_OK || data == null || data.getData() == null || save == null) return;
            Uri uri = data.getData();
            try (OutputStream os = getContentResolver().openOutputStream(uri, "wt")) {
                if (os == null) throw new IllegalStateException("No output stream");
                os.write(save.text.getBytes(StandardCharsets.UTF_8));
                os.flush();
                Toast.makeText(this, "Saved " + save.filename, Toast.LENGTH_SHORT).show();
                if (webView != null) webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('gd3d-native-save-complete',{detail:{ok:true}}));", null);
            } catch (Exception e) {
                Toast.makeText(this, "Save failed: " + e.getMessage(), Toast.LENGTH_LONG).show();
                if (webView != null) webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('gd3d-native-save-complete',{detail:{ok:false}}));", null);
            }
        }
    }

    @Override
    public void onBackPressed() {
        if (webView == null) {
            super.onBackPressed();
            return;
        }
        webView.evaluateJavascript(
                "(window.GD3DApp&&GD3DApp.onAndroidBack)?!!GD3DApp.onAndroidBack():false",
                value -> {
                    boolean handled = "true".equals(value);
                    if (!handled) {
                        if (webView.canGoBack()) webView.goBack();
                        else MainActivity.super.onBackPressed();
                    }
                });
    }
}
