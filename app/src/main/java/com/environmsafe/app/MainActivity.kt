package com.environmsafe.app

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import java.io.File

/**
 * Host for the EnvironmSafe procurement & finance system.
 *
 * The system itself lives in assets/app/index.html — the same file the website
 * serves — so the phone app and the website behave identically. Data is held in
 * the WebView's local storage, which belongs to this app and survives restarts.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var web: WebView
    private var pendingFiles: ValueCallback<Array<Uri>>? = null

    private val filePicker = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        pendingFiles?.onReceiveValue(
            WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
        )
        pendingFiles = null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        web = findViewById(R.id.webview)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = true
            loadWithOverviewMode = true
            useWideViewPort = true
            builtInZoomControls = false
            textZoom = 100
        }

        // Keep the app's own pages inside the app; hand real web links to the browser.
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url ?: return false
                if (url.scheme == "file") return false
                return try {
                    startActivity(Intent(Intent.ACTION_VIEW, url)); true
                } catch (e: ActivityNotFoundException) {
                    true
                }
            }
        }

        // Lets "Import CSV" and "Merge a backup" open the phone's file picker.
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                view: WebView?,
                callback: ValueCallback<Array<Uri>>?,
                params: FileChooserParams?
            ): Boolean {
                pendingFiles?.onReceiveValue(null)
                pendingFiles = callback
                val intent = params?.createIntent() ?: Intent(Intent.ACTION_GET_CONTENT).apply {
                    type = "*/*"
                }
                return try {
                    filePicker.launch(intent); true
                } catch (e: ActivityNotFoundException) {
                    pendingFiles = null
                    toast(getString(R.string.no_file_app)); false
                }
            }
        }

        web.addJavascriptInterface(FileBridge(), "AndroidBridge")

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (web.canGoBack()) web.goBack() else finish()
            }
        })

        if (savedInstanceState == null) web.loadUrl("file:///android_asset/app/index.html")
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onRestoreInstanceState(savedInstanceState: Bundle) {
        super.onRestoreInstanceState(savedInstanceState)
        web.restoreState(savedInstanceState)
    }

    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_LONG).show()

    /** Writes backups and CSV exports to a real file and offers to share them. */
    inner class FileBridge {
        @JavascriptInterface
        fun saveFile(name: String, content: String) {
            runOnUiThread {
                try {
                    val dir = File(getExternalFilesDir(null), "exports").apply { mkdirs() }
                    val safeName = name.replace(Regex("[^A-Za-z0-9._-]"), "_")
                    val out = File(dir, safeName)
                    out.writeText(content)

                    val uri = FileProvider.getUriForFile(
                        this@MainActivity, "$packageName.files", out
                    )
                    val send = Intent(Intent.ACTION_SEND).apply {
                        type = if (safeName.endsWith(".csv")) "text/csv" else "application/json"
                        putExtra(Intent.EXTRA_STREAM, uri)
                        putExtra(Intent.EXTRA_SUBJECT, safeName)
                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    }
                    startActivity(Intent.createChooser(send, getString(R.string.share_file)))
                    toast(getString(R.string.saved_to, out.absolutePath))
                } catch (e: Exception) {
                    toast(getString(R.string.save_failed, e.message ?: ""))
                }
            }
        }
    }
}
