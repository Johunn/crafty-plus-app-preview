package com.johunn.craftyplus

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.OutputStreamWriter
import java.util.concurrent.ConcurrentHashMap

class MainActivity : Activity() {
    private lateinit var webView: WebView
    private val mainHandler = Handler(Looper.getMainLooper())
    private val assetLoader by lazy {
        WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
    }
    private var unsubscribeEvents: (() -> Unit)? = null
    private var pendingFileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingScanId: String? = null
    private var pendingBatteryPreferenceId: String? = null
    private var pendingBatteryPreferenceValue = false
    private var scanner: BluetoothLeScanner? = null
    private var scanCallback: ScanCallback? = null
    private val scanResults = ConcurrentHashMap<String, ScanResult>()
    private val scanTimeout = Runnable { finishScan() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        webView = WebView(this)
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.settings.allowFileAccess = false
        webView.settings.allowContentAccess = false
        webView.addJavascriptInterface(NativeBridge(this), "CraftyAndroidBle")
        webView.webViewClient = object : WebViewClientCompat() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest) =
                assetLoader.shouldInterceptRequest(request.url)
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                view: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                pendingFileCallback?.onReceiveValue(null)
                pendingFileCallback = filePathCallback
                val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = "application/json"
                }
                startActivityForResult(intent, REQUEST_IMPORT_BACKUP)
                return true
            }
        }
        setContentView(webView)
        webView.loadUrl("https://appassets.androidplatform.net/assets/www/index.html")
    }

    override fun onResume() {
        super.onResume()
        if (unsubscribeEvents == null) {
            unsubscribeEvents = CraftyBleEvents.subscribe { event ->
                val quoted = JSONObject.quote(event)
                runOnUiThread {
                    webView.evaluateJavascript(
                        "window.__craftyAndroidBleEvent && window.__craftyAndroidBleEvent($quoted)",
                        null
                    )
                }
            }
        }
        webView.post {
            webView.evaluateJavascript("window.dispatchEvent(new Event('crafty-android-resume'))", null)
        }
    }

    override fun onStop() {
        if (::webView.isInitialized &&
            !getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getBoolean(CraftyBleService.KEY_BACKGROUND_TRACKING, true)) {
            stopService(Intent(this, CraftyBleService::class.java))
        }
        super.onStop()
    }

    @Deprecated("Deprecated in Android, kept for WebView chooser compatibility")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQUEST_IMPORT_BACKUP) {
            val callback = pendingFileCallback
            pendingFileCallback = null
            callback?.onReceiveValue(
                if (resultCode == RESULT_OK) data?.data?.let { arrayOf(it) } else null
            )
            return
        }
        if (requestCode == REQUEST_EXPORT_BACKUP) {
            val json = pendingBackupJson
            pendingBackupJson = null
            if (resultCode == RESULT_OK && data?.data != null && json != null) {
                runCatching {
                    contentResolver.openOutputStream(data.data!!)?.use { output ->
                        OutputStreamWriter(output, Charsets.UTF_8).use { it.write(json) }
                    }
                }.onFailure { showError(it.message ?: "Impossible d’enregistrer la sauvegarde") }
            }
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != REQUEST_BLE_PERMISSIONS) return
        pendingBatteryPreferenceId?.let { id ->
            pendingBatteryPreferenceId = null
            val granted = grantResults.any { it == PackageManager.PERMISSION_GRANTED }
            getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putBoolean(CraftyBleService.KEY_BATTERY_ALERTS, granted && pendingBatteryPreferenceValue)
                .apply()
            CraftyBleEvents.response(id, granted)
            return
        }
        val id = pendingScanId ?: return
        pendingScanId = null
        if (hasBlePermissions()) startDeviceScan(id)
        else CraftyBleEvents.failure(id, "Autorisation Bluetooth refusée", "NotAllowedError")
    }

    private fun receiveBridgeMessage(raw: String) {
        val request = runCatching { JSONObject(raw) }.getOrElse {
            CraftyBleEvents.failure("", "Commande Bluetooth invalide")
            return
        }
        val id = request.optString("id")
        when (request.optString("action")) {
            "scan" -> requestBlePermissions(id)
            "getDevices" -> {
                val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                val address = prefs.getString(KEY_DEVICE_ADDRESS, null)
                val name = prefs.getString(KEY_DEVICE_NAME, "CRAFTY+")
                val devices = JSONArray()
                if (!address.isNullOrBlank()) {
                    devices.put(JSONObject().put("id", address).put("name", name))
                }
                CraftyBleEvents.response(id, JSONObject().put("devices", devices))
            }
            "snapshot" -> CraftyBleEvents.response(id, UsageDatabase(this).snapshot())
            "getBatteryAlerts" -> CraftyBleEvents.response(
                id,
                getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .getBoolean(CraftyBleService.KEY_BATTERY_ALERTS, false)
            )
            "setBatteryAlerts" -> setBatteryAlerts(id, request.optBoolean("enabled", false))
            "getBackgroundTracking" -> CraftyBleEvents.response(
                id,
                getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .getBoolean(CraftyBleService.KEY_BACKGROUND_TRACKING, true)
            )
            "setBackgroundTracking" -> {
                val enabled = request.optBoolean("enabled", false)
                val saved = getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                    .putBoolean(CraftyBleService.KEY_BACKGROUND_TRACKING, enabled)
                    .commit()
                if (!saved) {
                    CraftyBleEvents.failure(id, "Impossible d’enregistrer le réglage du suivi")
                    return
                }
                val intent = Intent(this, CraftyBleService::class.java).apply {
                    action = CraftyBleService.ACTION_COMMAND
                    putExtra(
                        CraftyBleService.EXTRA_COMMAND,
                        JSONObject().put("action", "setBackgroundTracking")
                            .put("id", id).put("enabled", enabled).toString()
                    )
                }
                runCatching {
                    if (enabled && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                        ContextCompat.startForegroundService(this, intent)
                    else startService(intent)
                }.onFailure { CraftyBleEvents.failure(id, it.message ?: "Réglage du suivi impossible") }
            }
            "saveBackup" -> saveBackup(request.optString("json"))
            else -> {
                val intent = Intent(this, CraftyBleService::class.java).apply {
                    action = CraftyBleService.ACTION_COMMAND
                    putExtra(CraftyBleService.EXTRA_COMMAND, raw)
                }
                runCatching {
                    if (request.optString("action") == "connect" && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        ContextCompat.startForegroundService(this, intent)
                    } else {
                        startService(intent)
                    }
                }.onFailure { CraftyBleEvents.failure(id, it.message ?: "Bluetooth indisponible") }
            }
        }
    }

    private fun requestBlePermissions(id: String) {
        val required = mutableListOf<String>()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            required += Manifest.permission.BLUETOOTH_SCAN
            required += Manifest.permission.BLUETOOTH_CONNECT
        } else {
            required += Manifest.permission.ACCESS_FINE_LOCATION
        }
        if (Build.VERSION.SDK_INT >= 33) required += Manifest.permission.POST_NOTIFICATIONS
        val missing = required.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (missing.isEmpty()) startDeviceScan(id)
        else {
            pendingScanId = id
            ActivityCompat.requestPermissions(this, missing.toTypedArray(), REQUEST_BLE_PERMISSIONS)
        }
    }

    private fun setBatteryAlerts(id: String, enabled: Boolean) {
        if (!enabled || Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
            getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putBoolean(CraftyBleService.KEY_BATTERY_ALERTS, enabled)
                .apply()
            CraftyBleEvents.response(id, true)
            return
        }
        pendingBatteryPreferenceId = id
        pendingBatteryPreferenceValue = enabled
        ActivityCompat.requestPermissions(
            this,
            arrayOf(Manifest.permission.POST_NOTIFICATIONS),
            REQUEST_BLE_PERMISSIONS
        )
    }

    private fun hasBlePermissions(): Boolean {
        val required = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            listOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
        } else {
            listOf(Manifest.permission.ACCESS_FINE_LOCATION)
        }
        return required.all {
            ContextCompat.checkSelfPermission(this, it) == PackageManager.PERMISSION_GRANTED
        }
    }

    @Suppress("MissingPermission")
    private fun startDeviceScan(id: String) {
        val manager = getSystemService(BLUETOOTH_SERVICE) as BluetoothManager
        val adapter: BluetoothAdapter = manager.adapter
        if (!adapter.isEnabled) {
            CraftyBleEvents.failure(id, "Active d’abord le Bluetooth du téléphone", "NotAllowedError")
            return
        }
        scanner = adapter.bluetoothLeScanner
        if (scanner == null) {
            CraftyBleEvents.failure(id, "Le Bluetooth LE n’est pas disponible")
            return
        }
        pendingScanId = id
        scanResults.clear()
        val callback = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                // Keep all advertisements so a device with a hidden local name
                // can still be selected if the scan doesn't recognize it.
                scanResults[result.device.address] = result
            }

            override fun onScanFailed(errorCode: Int) {
                finishScan("Échec de la recherche Bluetooth ($errorCode)")
            }
        }
        scanCallback = callback
        runCatching {
            scanner?.startScan(
                null,
                ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(),
                callback
            )
            mainHandler.postDelayed(scanTimeout, SCAN_DURATION_MS)
        }.onFailure { finishScan(it.message ?: "Impossible de rechercher le CRAFTY+") }
    }

    @Suppress("MissingPermission")
    private fun finishScan(error: String? = null) {
        mainHandler.removeCallbacks(scanTimeout)
        scanCallback?.let { runCatching { scanner?.stopScan(it) } }
        scanCallback = null
        scanner = null
        val id = pendingScanId ?: return
        pendingScanId = null
        if (error != null) {
            CraftyBleEvents.failure(id, error)
            return
        }
        val allScannedDevices = scanResults.values
            .distinctBy { it.device.address }
            .sortedByDescending { it.rssi }
        if (allScannedDevices.isEmpty()) {
            CraftyBleEvents.failure(
                id,
                "Aucun appareil Bluetooth détecté. Vérifie que le CRAFTY+ et le Bluetooth du téléphone sont allumés, puis autorise « Appareils à proximité » dans les paramètres Android.",
                "NotFoundError"
            )
            return
        }
        val recognized = allScannedDevices.filter(::isSupportedStorzDevice).take(12)
        val candidates = recognized.ifEmpty { allScannedDevices.take(12) }
        val labels = candidates.map { result ->
            val name = getScanDeviceName(result)
            "$name  ·  ${result.rssi} dBm"
        }.toTypedArray()
        val chooser = AlertDialog.Builder(this)
            .setTitle(
                if (recognized.isNotEmpty()) "Choisir le CRAFTY+"
                else "Appareils Bluetooth à proximité"
            )
        if (recognized.isEmpty()) {
            chooser.setMessage("Le CRAFTY+ n’a pas été identifié par son nom. Choisis-le dans la liste des appareils détectés.")
        }
        chooser.setItems(labels) { _, which ->
            val result = candidates[which]
            val name = getScanDeviceName(result)
            getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString(KEY_DEVICE_ADDRESS, result.device.address)
                .putString(KEY_DEVICE_NAME, name)
                .apply()
            CraftyBleEvents.response(
                id,
                JSONObject().put("id", result.device.address).put("name", name)
            )
        }.setOnCancelListener {
            CraftyBleEvents.failure(id, "Sélection annulée", "NotFoundError")
        }.show()
    }

    private fun getScanDeviceName(result: ScanResult): String =
        result.scanRecord?.deviceName?.takeIf { it.isNotBlank() }
            ?: runCatching { result.device.name }.getOrNull()?.takeIf { it.isNotBlank() }
            ?: "Appareil Bluetooth (${result.device.address.takeLast(5)})"

    private fun isSupportedStorzDevice(result: ScanResult): Boolean {
        val name = getScanDeviceName(result).uppercase()
        val hasSupportedName = name.contains("CRAFTY") ||
            name.startsWith("STORZ&BICKEL") ||
            name.startsWith("STORZ & BICKEL") ||
            name.startsWith("S&B")
        val advertisesSupportedService = result.scanRecord?.serviceUuids?.any {
            SUPPORTED_DEVICE_SERVICES.any { uuid -> it.uuid.toString().equals(uuid, ignoreCase = true) }
        } == true
        return hasSupportedName || advertisesSupportedService
    }

    private var pendingBackupJson: String? = null
    private fun saveBackup(json: String) {
        pendingBackupJson = json
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "application/json"
            putExtra(Intent.EXTRA_TITLE, "crafty-plus-backup.json")
        }
        startActivityForResult(intent, REQUEST_EXPORT_BACKUP)
    }

    private fun showError(message: String) {
        AlertDialog.Builder(this).setMessage(message).setPositiveButton("OK", null).show()
    }

    override fun onDestroy() {
        mainHandler.removeCallbacks(scanTimeout)
        unsubscribeEvents?.invoke()
        webView.destroy()
        super.onDestroy()
    }

    private class NativeBridge(private val activity: MainActivity) {
        @JavascriptInterface
        fun postMessage(message: String) = activity.runOnUiThread {
            activity.receiveBridgeMessage(message)
        }

        @JavascriptInterface
        fun saveBackup(json: String) = activity.runOnUiThread { activity.saveBackup(json) }
    }

    companion object {
        private const val PREFS = "crafty-background"
        private const val KEY_DEVICE_ADDRESS = "device-address"
        private const val KEY_DEVICE_NAME = "device-name"
        private const val REQUEST_BLE_PERMISSIONS = 7101
        private const val REQUEST_IMPORT_BACKUP = 7102
        private const val REQUEST_EXPORT_BACKUP = 7103
        private const val SCAN_DURATION_MS = 8_000L
        private const val CRAFTY_SERVICE_UUID = "00000001-4c45-4b43-4942-265a524f5453"
        private val SUPPORTED_DEVICE_SERVICES = setOf(
            CRAFTY_SERVICE_UUID,
            "00000002-4c45-4b43-4942-265a524f5453",
            "00000003-4c45-4b43-4942-265a524f5453",
            "10100000-5354-4f52-5a26-4249434b454c",
            "10110000-5354-4f52-5a26-4249434b454c",
            "00000000-5354-4f52-5a26-4249434b454c"
        )
    }
}
