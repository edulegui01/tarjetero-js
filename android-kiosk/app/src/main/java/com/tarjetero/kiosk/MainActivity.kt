package com.tarjetero.kiosk

import android.app.AlertDialog
import android.content.SharedPreferences
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.view.View
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.tarjetero.kiosk.tts.TtsSpeaker

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var prefs: SharedPreferences
    private lateinit var ttsSpeaker: TtsSpeaker

    private val retryHandler = Handler(Looper.getMainLooper())
    private val retryRunnable = Runnable {
        getSavedUrl()?.let { loadUrl(it) }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        setContentView(R.layout.activity_main)

        prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
        webView = findViewById(R.id.webView)
        ttsSpeaker = TtsSpeaker(this)

        setupWebView()
        hideSystemUI()

        val savedUrl = getSavedUrl()
        if (savedUrl.isNullOrBlank()) {
            showUrlDialog(currentUrl = null, mandatory = true)
        } else {
            loadUrl(savedUrl)
        }
    }

    override fun onResume() {
        super.onResume()
        hideSystemUI()
        tryStartLockTask()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) {
            hideSystemUI()
        }
    }

    override fun onBackPressed() {
        // Kiosk mode: swallow the back button, never leave the app.
    }

    override fun onDestroy() {
        retryHandler.removeCallbacks(retryRunnable)
        ttsSpeaker.shutdown()
        super.onDestroy()
    }

    private fun hideSystemUI() {
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_FULLSCREEN
            )
    }

    private fun tryStartLockTask() {
        try {
            startLockTask()
        } catch (_: Exception) {
            // Device isn't owner/allowlisted for lock task mode; screen pinning
            // is a nice-to-have, so just keep running as a normal foreground app.
        }
    }

    private fun setupWebView() {
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            cacheMode = WebSettings.LOAD_DEFAULT
        }

        webView.webChromeClient = WebChromeClient()
        webView.addJavascriptInterface(TtsBridge(ttsSpeaker), "AndroidTts")

        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                retryHandler.removeCallbacks(retryRunnable)
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                super.onReceivedError(view, request, error)
                if (request == null || request.isForMainFrame) {
                    scheduleRetry()
                }
            }
        }

        webView.setOnLongClickListener {
            showUrlDialog(currentUrl = getSavedUrl(), mandatory = false)
            true
        }
    }

    private fun scheduleRetry() {
        retryHandler.removeCallbacks(retryRunnable)
        retryHandler.postDelayed(retryRunnable, RETRY_DELAY_MS)
    }

    private fun loadUrl(url: String) {
        retryHandler.removeCallbacks(retryRunnable)
        webView.loadUrl(url)
    }

    private fun getSavedUrl(): String? = prefs.getString(KEY_URL, null)

    private fun saveUrl(url: String) {
        prefs.edit().putString(KEY_URL, url).apply()
    }

    private fun showUrlDialog(currentUrl: String?, mandatory: Boolean) {
        val input = EditText(this).apply {
            inputType = InputType.TYPE_TEXT_VARIATION_URI or InputType.TYPE_CLASS_TEXT
            hint = getString(R.string.dialog_hint)
            setText(currentUrl ?: "")
        }

        val builder = AlertDialog.Builder(this)
            .setTitle(R.string.dialog_title)
            .setMessage(R.string.dialog_message)
            .setView(input)
            .setCancelable(!mandatory)
            .setPositiveButton(R.string.dialog_positive, null)

        if (!mandatory) {
            builder.setNegativeButton(R.string.dialog_negative, null)
        }

        val dialog = builder.create()

        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val url = input.text.toString().trim()
                if (isValidUrl(url)) {
                    saveUrl(url)
                    loadUrl(url)
                    dialog.dismiss()
                } else {
                    Toast.makeText(this, R.string.dialog_invalid_url, Toast.LENGTH_SHORT).show()
                }
            }
        }

        dialog.show()
    }

    private fun isValidUrl(url: String): Boolean {
        return url.startsWith("http://") || url.startsWith("https://")
    }

    companion object {
        private const val PREFS_NAME = "kiosk_prefs"
        private const val KEY_URL = "server_url"
        private const val RETRY_DELAY_MS = 5000L
    }
}

/** Puente expuesto a la página como `window.AndroidTts.speak(texto)`. */
private class TtsBridge(private val ttsSpeaker: TtsSpeaker) {
    @JavascriptInterface
    fun speak(text: String) {
        ttsSpeaker.speak(text)
    }
}
