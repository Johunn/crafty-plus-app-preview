package com.johunn.craftyplus

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothProfile
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.ArrayDeque

class CraftyBleService : Service() {
    private data class Operation(
        val id: String?,
        val type: String,
        val serviceUuid: String,
        val characteristicUuid: String,
        val value: ByteArray? = null
    )

    private val handler = Handler(Looper.getMainLooper())
    private val database by lazy { UsageDatabase(this) }
    private val preferences by lazy { getSharedPreferences(PREFS, Context.MODE_PRIVATE) }
    private val operations = ArrayDeque<Operation>()
    private val activeNotifications = mutableSetOf<String>()
    private val requestedNotifications = mutableSetOf<String>()
    private var currentOperation: Operation? = null
    private var gatt: BluetoothGatt? = null
    private var deviceAddress: String? = null
    private var pendingConnectId: String? = null
    private var trackingEnabled = false
    private var connected = false
    private var cycleId: String? = null
    private var consumptionSessionId: String? = null
    private var candidateStartedAt: Long? = null
    private var coolingStartedAt: Long? = null
    private var lastTemperature: Int? = null
    private var lastTemperatureAt: Long = 0
    private var reconnectAttempt = 0

    private val pollTemperature = object : Runnable {
        override fun run() {
            if (connected) {
                val characteristic = findCharacteristic(SERVICE_CRAFTY_CONTROL, CHAR_CURRENT_TEMP)
                val temperatureIsStale = lastTemperatureAt == 0L ||
                    System.currentTimeMillis() - lastTemperatureAt >= TEMP_FALLBACK_STALE_MS
                if (characteristic != null && temperatureIsStale && currentOperation == null && operations.isEmpty()) {
                    enqueue(Operation(null, "read", SERVICE_CRAFTY_CONTROL, CHAR_CURRENT_TEMP))
                }
                handler.postDelayed(this, POLL_INTERVAL_MS)
            }
        }
    }

    private val qualifyCandidate = object : Runnable {
        override fun run() {
            val startedAt = candidateStartedAt ?: return
            val now = System.currentTimeMillis()
            val temp = lastTemperature
            if (connected && temp != null && temp > HOT_THRESHOLD_C && now - lastTemperatureAt <= MAX_TEMP_GAP_MS) {
                consumptionSessionId = database.startSession("CRAFTY+", startedAt, now)
                database.touchSession(consumptionSessionId!!, now)
                candidateStartedAt = null
                updateOngoingNotification(temp, null)
            } else {
                candidateStartedAt = null
            }
        }
    }

    private val endAfterCooling = object : Runnable {
        override fun run() {
            val session = consumptionSessionId ?: return
            val belowAt = coolingStartedAt ?: return
            if (lastTemperature == null || lastTemperature!! <= HOT_THRESHOLD_C) {
                database.endSession(session, belowAt)
                consumptionSessionId = null
                coolingStartedAt = null
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        ensureNotificationChannels()
        database.recoverOpenRecords()
        trackingEnabled = preferences.getBoolean(KEY_TRACKING, false)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val raw = intent?.getStringExtra(EXTRA_COMMAND)
        if (intent?.action == ACTION_STOP) {
            stopTracking()
            return START_NOT_STICKY
        }
        if (raw == null) {
            if (trackingEnabled) {
                startForegroundIfNeeded()
                deviceAddress = preferences.getString(KEY_ADDRESS, null)
                connectSavedDevice(null)
                return START_STICKY
            }
            stopSelf()
            return START_NOT_STICKY
        }
        val command = runCatching { JSONObject(raw) }.getOrElse {
            CraftyBleEvents.failure("", "Commande Bluetooth invalide")
            return START_NOT_STICKY
        }
        handleCommand(command)
        return if (trackingEnabled) START_STICKY else START_NOT_STICKY
    }

    private fun handleCommand(command: JSONObject) {
        val id = command.optString("id")
        when (command.optString("action")) {
            "connect" -> {
                val address = command.optString("deviceId").takeIf { it.isNotBlank() }
                    ?: preferences.getString(KEY_ADDRESS, null)
                if (address == null) {
                    CraftyBleEvents.failure(id, "Choisis d’abord le CRAFTY+", "NotFoundError")
                    return
                }
                trackingEnabled = true
                deviceAddress = address
                preferences.edit().putBoolean(KEY_TRACKING, true).putString(KEY_ADDRESS, address).apply()
                startForegroundIfNeeded()
                if (connected && gatt?.device?.address == address) CraftyBleEvents.response(id, true)
                else {
                    pendingConnectId = id
                    connectSavedDevice(id, autoConnect = false)
                }
            }
            "disconnect" -> {
                CraftyBleEvents.response(id, true)
                stopTracking()
            }
            "hasService" -> {
                val uuid = command.optString("serviceUuid").lowercase()
                CraftyBleEvents.response(id, gatt?.getService(uuid(uuid)) != null)
            }
            "hasCharacteristic" -> {
                val characteristic = findCharacteristic(
                    command.optString("serviceUuid"), command.optString("characteristicUuid")
                )
                CraftyBleEvents.response(id, characteristic != null)
            }
            "read" -> enqueue(Operation(id, "read", command.optString("serviceUuid"), command.optString("characteristicUuid")))
            "write" -> {
                val value = command.optJSONArray("value")?.let { array ->
                    ByteArray(array.length()) { index -> array.optInt(index).toByte() }
                } ?: byteArrayOf()
                enqueue(Operation(id, "write", command.optString("serviceUuid"), command.optString("characteristicUuid"), value))
            }
            "notifyStart" -> {
                val serviceUuid = command.optString("serviceUuid")
                val characteristicUuid = command.optString("characteristicUuid")
                val key = characteristicKey(serviceUuid, characteristicUuid)
                if (key in activeNotifications || key in requestedNotifications) {
                    CraftyBleEvents.response(id, true)
                } else {
                    requestedNotifications.add(key)
                    enqueue(Operation(id, "notifyStart", serviceUuid, characteristicUuid))
                }
            }
            "notifyStop" -> CraftyBleEvents.response(id, true)
            else -> CraftyBleEvents.failure(id, "Commande Bluetooth inconnue")
        }
    }

    @Suppress("MissingPermission")
    private fun connectSavedDevice(requestId: String?, autoConnect: Boolean = true) {
        if (!trackingEnabled) return
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
            requestId?.let { CraftyBleEvents.failure(it, "Autorisation Bluetooth absente", "NotAllowedError") }
            return
        }
        val address = deviceAddress ?: preferences.getString(KEY_ADDRESS, null)
        if (address.isNullOrBlank()) {
            requestId?.let { CraftyBleEvents.failure(it, "Aucun CRAFTY+ enregistré", "NotFoundError") }
            return
        }
        if (connected && gatt?.device?.address == address) {
            requestId?.let { CraftyBleEvents.response(it, true) }
            return
        }
        if (autoConnect && gatt?.device?.address == address && !connected) return
        deviceAddress = address
        pendingConnectId = requestId ?: pendingConnectId
        runCatching {
            gatt?.close()
            gatt = null
            val device = (getSystemService(BLUETOOTH_SERVICE) as android.bluetooth.BluetoothManager)
                .adapter.getRemoteDevice(address)
            gatt = device.connectGatt(this, autoConnect, gattCallback, BluetoothDevice.TRANSPORT_LE)
            updateOngoingNotification(null, "Connexion au CRAFTY+…")
        }.onFailure {
            pendingConnectId?.let { id -> CraftyBleEvents.failure(id, it.message ?: "Connexion impossible") }
            pendingConnectId = null
            scheduleReconnect()
        }
    }

    private val gattCallback = object : BluetoothGattCallback() {
        @Suppress("MissingPermission")
        override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
            if (this@CraftyBleService.gatt !== gatt) {
                runCatching { gatt.close() }
                return
            }
            if (newState == BluetoothProfile.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS) {
                this@CraftyBleService.gatt = gatt
                gatt.discoverServices()
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                onDisconnected(gatt, status)
            }
        }

        override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
            if (this@CraftyBleService.gatt !== gatt) {
                runCatching { gatt.close() }
                return
            }
            if (status != BluetoothGatt.GATT_SUCCESS) {
                onDisconnected(gatt, status)
                return
            }
            connected = true
            reconnectAttempt = 0
            cycleId = database.startCycle("CRAFTY+", System.currentTimeMillis())
            CraftyBleEvents.emit(
                JSONObject().put("kind", "connection").put("state", "connected")
                    .put("deviceId", gatt.device.address)
            )
            pendingConnectId?.let { CraftyBleEvents.response(it, true) }
            pendingConnectId = null
            updateOngoingNotification(null, "Connecté · suivi actif")
            enableInternalNotifications()
            handler.removeCallbacks(pollTemperature)
            handler.postDelayed(pollTemperature, POLL_INTERVAL_MS)
        }

        @Deprecated("Deprecated by Android 13")
        override fun onCharacteristicRead(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
            completeCharacteristicOperation(status, characteristic.value)
        }

        override fun onCharacteristicRead(
            gatt: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
            value: ByteArray,
            status: Int
        ) {
            completeCharacteristicOperation(status, value)
        }

        @Deprecated("Deprecated by Android 13")
        override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
            handleNotification(characteristic.uuid.toString(), characteristic.value)
        }

        override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray) {
            handleNotification(characteristic.uuid.toString(), value)
        }

        @Deprecated("Deprecated by Android 13")
        override fun onCharacteristicWrite(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
            completeCharacteristicOperation(status, null)
        }

        override fun onDescriptorWrite(gatt: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
            completeDescriptorOperation(status, descriptor)
        }
    }

    private fun enableInternalNotifications() {
        listOf(
            SERVICE_CRAFTY_CONTROL to CHAR_CURRENT_TEMP,
            SERVICE_CRAFTY_CONTROL to CHAR_BATTERY,
            SERVICE_CRAFTY_STATUS to CHAR_PROJECT_REGISTER
        ).forEach { (service, characteristic) ->
            val key = characteristicKey(service, characteristic)
            if (key !in activeNotifications && findCharacteristic(service, characteristic) != null) {
                requestedNotifications.add(key)
                enqueue(Operation(null, "notifyStart", service, characteristic))
            }
        }
    }

    private fun handleNotification(characteristicUuid: String, bytes: ByteArray?) {
        val serviceUuid = when (characteristicUuid.lowercase()) {
            CHAR_CURRENT_TEMP -> SERVICE_CRAFTY_CONTROL
            CHAR_BATTERY -> SERVICE_CRAFTY_CONTROL
            CHAR_PROJECT_REGISTER -> SERVICE_CRAFTY_STATUS
            else -> gatt?.services?.firstOrNull { service -> service.getCharacteristic(uuid(characteristicUuid)) != null }?.uuid?.toString()
        } ?: return
        val value = bytes ?: byteArrayOf()
        if (serviceUuid.equals(SERVICE_CRAFTY_CONTROL, true) && characteristicUuid.equals(CHAR_CURRENT_TEMP, true)) {
            acceptTemperature(value, System.currentTimeMillis())
        } else if (serviceUuid.equals(SERVICE_CRAFTY_CONTROL, true) && characteristicUuid.equals(CHAR_BATTERY, true)) {
            val battery = uint16(value)
            maybeAlertLowBattery(battery)
            updateOngoingNotification(lastTemperature, "Batterie $battery %")
        }
        val array = JSONArray().apply { value.forEach { put(it.toInt() and 0xff) } }
        CraftyBleEvents.emit(
            JSONObject().put("kind", "notification")
                .put("serviceUuid", serviceUuid.lowercase())
                .put("characteristicUuid", characteristicUuid.lowercase())
                .put("value", array)
        )
    }

    private fun recordTemperature(temp: Int, at: Long) {
        if (!connected) return
        cycleId?.let { database.touchCycle(it, at) }
        if (temp > HOT_THRESHOLD_C) {
            coolingStartedAt = null
            handler.removeCallbacks(endAfterCooling)
            val active = consumptionSessionId
            if (active != null) {
                database.touchSession(active, at)
            } else if (candidateStartedAt == null) {
                candidateStartedAt = at
                handler.removeCallbacks(qualifyCandidate)
                handler.postDelayed(qualifyCandidate, QUALIFY_DURATION_MS)
            }
        } else {
            candidateStartedAt = null
            handler.removeCallbacks(qualifyCandidate)
            if (consumptionSessionId != null && coolingStartedAt == null) {
                coolingStartedAt = at
                handler.removeCallbacks(endAfterCooling)
                handler.postDelayed(endAfterCooling, COOLING_GRACE_MS)
            }
        }
    }

    private fun acceptTemperature(bytes: ByteArray, at: Long) {
        val temp = Math.round(uint16(bytes) / 10.0).toInt()
        if (temp !in 0..260) return
        if (lastTemperatureAt > 0 && at - lastTemperatureAt > MAX_TEMP_GAP_MS) {
            candidateStartedAt = null
            handler.removeCallbacks(qualifyCandidate)
            consumptionSessionId?.let { database.endSession(it, lastTemperatureAt, estimated = true) }
            consumptionSessionId = null
            coolingStartedAt = null
            handler.removeCallbacks(endAfterCooling)
        }
        lastTemperature = temp
        lastTemperatureAt = at
        recordTemperature(temp, at)
        updateOngoingNotification(temp, null)
    }

    private fun completeCharacteristicOperation(status: Int, bytes: ByteArray?) {
        val op = currentOperation ?: return
        if (status == BluetoothGatt.GATT_SUCCESS && op.type == "read" && bytes != null) {
            if (op.serviceUuid.equals(SERVICE_CRAFTY_CONTROL, true) &&
                op.characteristicUuid.equals(CHAR_CURRENT_TEMP, true)) {
                acceptTemperature(bytes, System.currentTimeMillis())
            } else if (op.serviceUuid.equals(SERVICE_CRAFTY_CONTROL, true) &&
                op.characteristicUuid.equals(CHAR_BATTERY, true)) {
                maybeAlertLowBattery(uint16(bytes))
            }
            op.id?.let { id -> CraftyBleEvents.response(id, JSONArray().apply { bytes.forEach { put(it.toInt() and 0xff) } }) }
        } else if (status == BluetoothGatt.GATT_SUCCESS && op.type == "write") {
            op.id?.let { CraftyBleEvents.response(it, true) }
        } else {
            op.id?.let { CraftyBleEvents.failure(it, "Échange Bluetooth refusé ($status)") }
        }
        currentOperation = null
        pumpOperations()
    }

    private fun completeDescriptorOperation(status: Int, descriptor: BluetoothGattDescriptor) {
        val op = currentOperation ?: return
        val key = characteristicKey(op.serviceUuid, op.characteristicUuid)
        if (status == BluetoothGatt.GATT_SUCCESS) {
            if (op.type == "notifyStart") activeNotifications.add(key) else activeNotifications.remove(key)
            op.id?.let { CraftyBleEvents.response(it, true) }
        } else {
            if (op.type == "notifyStart") requestedNotifications.remove(key)
            op.id?.let { CraftyBleEvents.failure(it, "Notifications Bluetooth indisponibles ($status)") }
        }
        currentOperation = null
        pumpOperations()
    }

    private fun enqueue(operation: Operation) {
        operations.addLast(operation)
        pumpOperations()
    }

    @Suppress("MissingPermission", "DEPRECATION")
    private fun pumpOperations() {
        if (!connected || currentOperation != null || operations.isEmpty()) return
        val op = operations.removeFirst()
        val remoteGatt = gatt ?: return failOperation(op, "Bluetooth déconnecté")
        val characteristic = findCharacteristic(op.serviceUuid, op.characteristicUuid)
            ?: return failOperation(op, "Caractéristique Bluetooth absente", "NotFoundError")
        currentOperation = op
        val began = runCatching {
            when (op.type) {
                "read" -> remoteGatt.readCharacteristic(characteristic)
                "write" -> {
                    val bytes = op.value ?: byteArrayOf()
                    if (Build.VERSION.SDK_INT >= 33) {
                        remoteGatt.writeCharacteristic(characteristic, bytes, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT) == BluetoothGatt.GATT_SUCCESS
                    } else {
                        characteristic.value = bytes
                        characteristic.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
                        remoteGatt.writeCharacteristic(characteristic)
                    }
                }
                "notifyStart", "notifyStop" -> {
                    val enabled = op.type == "notifyStart"
                    remoteGatt.setCharacteristicNotification(characteristic, enabled)
                    val descriptor = characteristic.getDescriptor(uuid(CCCD_UUID))
                        ?: throw IllegalStateException("Descripteur de notification absent")
                    if (Build.VERSION.SDK_INT >= 33) {
                        remoteGatt.writeDescriptor(descriptor, if (enabled) BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE else BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE) == BluetoothGatt.GATT_SUCCESS
                    } else {
                        descriptor.value = if (enabled) BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE else BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE
                        remoteGatt.writeDescriptor(descriptor)
                    }
                }
                else -> false
            }
        }.getOrElse {
            failOperation(op, it.message ?: "Opération Bluetooth impossible")
            return
        }
        if (!began) failOperation(op, "Impossible de lancer l’opération Bluetooth")
    }

    private fun failOperation(op: Operation, message: String, name: String = "NetworkError") {
        op.id?.let { CraftyBleEvents.failure(it, message, name) }
        if (currentOperation == op) currentOperation = null
        pumpOperations()
    }

    private fun findCharacteristic(serviceUuid: String, characteristicUuid: String): BluetoothGattCharacteristic? =
        gatt?.getService(uuid(serviceUuid))?.getCharacteristic(uuid(characteristicUuid))

    private fun characteristicKey(serviceUuid: String, characteristicUuid: String) =
        "${serviceUuid.lowercase()}:${characteristicUuid.lowercase()}"

    private fun maybeAlertLowBattery(battery: Int) {
        if (!preferences.getBoolean(KEY_BATTERY_ALERTS, false) || battery > LOW_BATTERY_THRESHOLD) return
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val previous = preferences.getInt(KEY_LAST_BATTERY_LEVEL, 100)
        preferences.edit().putInt(KEY_LAST_BATTERY_LEVEL, battery).apply()
        if (previous <= LOW_BATTERY_THRESHOLD) return
        val notification = NotificationCompat.Builder(this, LOW_BATTERY_CHANNEL)
            .setSmallIcon(android.R.drawable.stat_sys_warning)
            .setContentTitle("Batterie faible · CRAFTY+")
            .setContentText("Il reste $battery % de batterie.")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .build()
        runCatching { (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).notify(LOW_BATTERY_NOTIFICATION, notification) }
    }

    private fun updateOngoingNotification(temp: Int?, message: String?) {
        val text = message ?: temp?.let { "Température $it °C · suivi actif" } ?: "Suivi CRAFTY+ actif"
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val stop = PendingIntent.getService(
            this, 1, Intent(this, CraftyBleService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val notification = NotificationCompat.Builder(this, TRACKING_CHANNEL)
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setContentTitle("CRAFTY+ · suivi en arrière-plan")
            .setContentText(text)
            .setContentIntent(open)
            .addAction(android.R.drawable.ic_media_pause, "Arrêter le suivi", stop)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
        runCatching { (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).notify(TRACKING_NOTIFICATION, notification) }
    }

    private fun startForegroundIfNeeded() {
        if (isForeground) return
        val notification = NotificationCompat.Builder(this, TRACKING_CHANNEL)
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setContentTitle("CRAFTY+ · suivi en arrière-plan")
            .setContentText("Connexion Bluetooth en cours…")
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(TRACKING_NOTIFICATION, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
        } else {
            startForeground(TRACKING_NOTIFICATION, notification)
        }
        isForeground = true
    }

    private fun ensureNotificationChannels() {
        if (Build.VERSION.SDK_INT < 26) return
        val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(NotificationChannel(TRACKING_CHANNEL, "Suivi CRAFTY+", NotificationManager.IMPORTANCE_LOW))
        manager.createNotificationChannel(NotificationChannel(LOW_BATTERY_CHANNEL, "Batterie CRAFTY+", NotificationManager.IMPORTANCE_HIGH))
    }

    private fun onDisconnected(disconnectedGatt: BluetoothGatt, status: Int) {
        if (gatt !== disconnectedGatt) {
            runCatching { disconnectedGatt.close() }
            return
        }
        gatt = null
        runCatching { disconnectedGatt.close() }
        connected = false
        handler.removeCallbacks(pollTemperature)
        handler.removeCallbacks(qualifyCandidate)
        handler.removeCallbacks(endAfterCooling)
        val now = System.currentTimeMillis()
        cycleId?.let { database.endCycle(it, now, estimated = false) }
        cycleId = null
        consumptionSessionId?.let { database.endSession(it, now, estimated = true) }
        consumptionSessionId = null
        candidateStartedAt = null
        coolingStartedAt = null
        lastTemperature = null
        lastTemperatureAt = 0
        pendingConnectId?.let { CraftyBleEvents.failure(it, "Connexion Bluetooth interrompue ($status)") }
        pendingConnectId = null
        currentOperation?.id?.let { CraftyBleEvents.failure(it, "Connexion Bluetooth interrompue") }
        currentOperation = null
        operations.clear()
        activeNotifications.clear()
        requestedNotifications.clear()
        CraftyBleEvents.emit(
            JSONObject().put("kind", "connection")
                .put("state", if (trackingEnabled) "disconnected" else "stopped")
                .put("deviceId", disconnectedGatt.device.address)
                .put("status", status)
        )
        if (trackingEnabled) {
            updateOngoingNotification(null, "Appareil hors portée · reconnexion automatique")
            scheduleReconnect()
        }
    }

    private fun scheduleReconnect() {
        if (!trackingEnabled || isFinishing) return
        reconnectAttempt = (reconnectAttempt + 1).coerceAtMost(6)
        val delay = (2_000L shl (reconnectAttempt - 1)).coerceAtMost(30_000L)
        handler.postDelayed({
            if (trackingEnabled && !connected && gatt == null) connectSavedDevice(null, autoConnect = true)
        }, delay)
    }

    private fun stopTracking() {
        trackingEnabled = false
        isFinishing = true
        preferences.edit().putBoolean(KEY_TRACKING, false).apply()
        (gatt?.device?.address ?: deviceAddress)?.let { address ->
            CraftyBleEvents.emit(
                JSONObject().put("kind", "connection").put("state", "stopped")
                    .put("deviceId", address)
            )
        }
        handler.removeCallbacks(pollTemperature)
        handler.removeCallbacks(qualifyCandidate)
        handler.removeCallbacks(endAfterCooling)
        connected = false
        val now = System.currentTimeMillis()
        cycleId?.let { database.endCycle(it, now, estimated = false) }
        consumptionSessionId?.let { database.endSession(it, now, estimated = false) }
        cycleId = null
        consumptionSessionId = null
        runCatching { gatt?.disconnect() }
        runCatching { gatt?.close() }
        gatt = null
        operations.clear()
        currentOperation = null
        stopForeground(STOP_FOREGROUND_REMOVE)
        isForeground = false
        stopSelf()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        runCatching { gatt?.close() }
        if (!isFinishing && trackingEnabled) {
            val now = System.currentTimeMillis()
            cycleId?.let { database.endCycle(it, now, estimated = true) }
            consumptionSessionId?.let { database.endSession(it, now, estimated = true) }
        }
        super.onDestroy()
    }

    private var isForeground = false
    private var isFinishing = false

    companion object {
        const val ACTION_COMMAND = "com.johunn.craftyplus.COMMAND"
        const val ACTION_STOP = "com.johunn.craftyplus.STOP_TRACKING"
        const val EXTRA_COMMAND = "command-json"
        private const val PREFS = "crafty-background"
        private const val KEY_TRACKING = "tracking-enabled"
        private const val KEY_ADDRESS = "device-address"
        const val KEY_BATTERY_ALERTS = "battery-alerts-enabled"
        private const val KEY_LAST_BATTERY_LEVEL = "last-battery-level"
        private const val TRACKING_CHANNEL = "crafty-tracking"
        private const val LOW_BATTERY_CHANNEL = "crafty-low-battery"
        private const val TRACKING_NOTIFICATION = 4201
        private const val LOW_BATTERY_NOTIFICATION = 4202
        private const val HOT_THRESHOLD_C = 170
        private const val QUALIFY_DURATION_MS = 3 * 60 * 1000L
        private const val COOLING_GRACE_MS = 90 * 1000L
        private const val MAX_TEMP_GAP_MS = 12_000L
        private const val POLL_INTERVAL_MS = 4_000L
        private const val TEMP_FALLBACK_STALE_MS = 6_000L
        private const val LOW_BATTERY_THRESHOLD = 20
        private const val SERVICE_CRAFTY_CONTROL = "00000001-4c45-4b43-4942-265a524f5453"
        private const val SERVICE_CRAFTY_STATUS = "00000003-4c45-4b43-4942-265a524f5453"
        private const val CHAR_CURRENT_TEMP = "00000011-4c45-4b43-4942-265a524f5453"
        private const val CHAR_BATTERY = "00000041-4c45-4b43-4942-265a524f5453"
        private const val CHAR_PROJECT_REGISTER = "00000093-4c45-4b43-4942-265a524f5453"
        private const val CCCD_UUID = "00002902-0000-1000-8000-00805f9b34fb"

        private fun uuid(value: String) = java.util.UUID.fromString(value)
        private fun characteristicKey(service: String, characteristic: String) = "${service.lowercase()}:${characteristic.lowercase()}"
        private fun uint16(value: ByteArray): Int = if (value.size >= 2) {
            ByteBuffer.wrap(value, 0, 2).order(ByteOrder.LITTLE_ENDIAN).short.toInt() and 0xffff
        } else value.firstOrNull()?.toInt()?.and(0xff) ?: 0
    }
}
