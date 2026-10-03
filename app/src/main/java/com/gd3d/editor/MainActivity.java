package com.gd3d.editor;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

public class MainActivity extends Activity {
    private static final int REQ_SAVE_TEXT = 7001;
    private static final int REQ_FILE_CHOOSER = 7002;

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
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        enterImmersive();

        webView = new WebView(this);
        setContentView(webView);

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

        webView.setWebViewClient(new WebViewClient());
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

        webView.loadUrl("file:///android_asset/index.html");
    }

    private void enterImmersive() {
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_FULLSCREEN |
                    View.SYSTEM_UI_FLAG_HIDE_NAVIGATION |
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY |
                    View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN |
                    View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION |
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) enterImmersive();
    }

    public class AndroidBridge {
        @JavascriptInterface
        public void saveText(String filename, String mimeType, String text) {
            runOnUiThread(() -> launchSave(filename, mimeType, text));
        }

        @JavascriptInterface
        public String appVersion() {
            return "0.80-alpha";
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
                if (webView != null) {
                    webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('gd3d-native-save-complete',{detail:{ok:true}}));", null);
                }
            } catch (Exception e) {
                Toast.makeText(this, "Save failed: " + e.getMessage(), Toast.LENGTH_LONG).show();
                if (webView != null) {
                    webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('gd3d-native-save-complete',{detail:{ok:false}}));", null);
                }
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
