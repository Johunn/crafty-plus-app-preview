package com.johunn.craftyplus

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

class UsageDatabase(context: Context) : SQLiteOpenHelper(context, "crafty_background.db", null, 1) {
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("""
            CREATE TABLE cycles (
                id TEXT PRIMARY KEY,
                device TEXT NOT NULL,
                started_at INTEGER NOT NULL,
                ended_at INTEGER,
                last_seen_at INTEGER NOT NULL,
                estimated_end INTEGER NOT NULL DEFAULT 0
            )
        """.trimIndent())
        db.execSQL("""
            CREATE TABLE sessions (
                id TEXT PRIMARY KEY,
                device TEXT NOT NULL,
                started_at INTEGER NOT NULL,
                qualified_at INTEGER NOT NULL,
                ended_at INTEGER,
                last_seen_at INTEGER NOT NULL,
                estimated_end INTEGER NOT NULL DEFAULT 0
            )
        """.trimIndent())
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit

    @Synchronized
    fun recoverOpenRecords() {
        val db = writableDatabase
        db.execSQL("UPDATE cycles SET ended_at = last_seen_at, estimated_end = 1 WHERE ended_at IS NULL")
        db.execSQL("UPDATE sessions SET ended_at = last_seen_at, estimated_end = 1 WHERE ended_at IS NULL")
    }

    @Synchronized
    fun startCycle(device: String, at: Long): String {
        val id = UUID.randomUUID().toString()
        writableDatabase.insertOrThrow("cycles", null, ContentValues().apply {
            put("id", id); put("device", device); put("started_at", at); put("last_seen_at", at)
        })
        return id
    }

    @Synchronized
    fun touchCycle(id: String, at: Long) = update("cycles", id, ContentValues().apply { put("last_seen_at", at) })

    @Synchronized
    fun endCycle(id: String, at: Long, estimated: Boolean = false) = update("cycles", id, ContentValues().apply {
        put("ended_at", at); put("last_seen_at", at); put("estimated_end", if (estimated) 1 else 0)
    })

    @Synchronized
    fun openSession(): String? = readableDatabase.rawQuery(
        "SELECT id FROM sessions WHERE ended_at IS NULL ORDER BY qualified_at DESC LIMIT 1", null
    ).use { if (it.moveToFirst()) it.getString(0) else null }

    @Synchronized
    fun startSession(device: String, startedAt: Long, qualifiedAt: Long): String {
        val id = UUID.randomUUID().toString()
        writableDatabase.insertOrThrow("sessions", null, ContentValues().apply {
            put("id", id); put("device", device); put("started_at", startedAt)
            put("qualified_at", qualifiedAt); put("last_seen_at", qualifiedAt)
        })
        return id
    }

    @Synchronized
    fun touchSession(id: String, at: Long) = update("sessions", id, ContentValues().apply { put("last_seen_at", at) })

    @Synchronized
    fun endSession(id: String, at: Long, estimated: Boolean = false) = update("sessions", id, ContentValues().apply {
        put("ended_at", at); put("last_seen_at", at); put("estimated_end", if (estimated) 1 else 0)
    })

    @Synchronized
    fun snapshot(): JSONObject {
        val cycles = JSONArray()
        readableDatabase.rawQuery("SELECT id, device, started_at, ended_at, last_seen_at, estimated_end FROM cycles ORDER BY started_at", null).use { cursor ->
            while (cursor.moveToNext()) cycles.put(JSONObject().apply {
                put("id", cursor.getString(0)); put("device", cursor.getString(1)); put("startedAt", cursor.getLong(2))
                put("endedAt", if (cursor.isNull(3)) JSONObject.NULL else cursor.getLong(3))
                put("lastSeenAt", cursor.getLong(4)); if (cursor.getInt(5) != 0) put("estimatedEnd", true)
            })
        }
        val sessions = JSONArray()
        readableDatabase.rawQuery("SELECT id, device, started_at, qualified_at, ended_at, last_seen_at, estimated_end FROM sessions ORDER BY started_at", null).use { cursor ->
            while (cursor.moveToNext()) sessions.put(JSONObject().apply {
                put("id", cursor.getString(0)); put("device", cursor.getString(1)); put("startedAt", cursor.getLong(2))
                put("qualifiedAt", cursor.getLong(3)); put("endedAt", if (cursor.isNull(4)) JSONObject.NULL else cursor.getLong(4))
                put("lastSeenAt", cursor.getLong(5)); if (cursor.getInt(6) != 0) put("estimatedEnd", true)
            })
        }
        return JSONObject().put("cycles", cycles).put("sessions", sessions)
    }

    private fun update(table: String, id: String, values: ContentValues) {
        writableDatabase.update(table, values, "id = ? AND ended_at IS NULL", arrayOf(id))
    }
}
