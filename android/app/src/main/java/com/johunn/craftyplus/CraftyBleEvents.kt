package com.johunn.craftyplus

import org.json.JSONObject
import java.util.concurrent.CopyOnWriteArraySet

object CraftyBleEvents {
    private val listeners = CopyOnWriteArraySet<(String) -> Unit>()

    fun subscribe(listener: (String) -> Unit): () -> Unit {
        listeners.add(listener)
        return { listeners.remove(listener) }
    }

    fun emit(event: JSONObject) {
        val message = event.toString()
        listeners.forEach { listener -> runCatching { listener(message) } }
    }

    fun response(id: String, value: Any? = JSONObject.NULL) {
        emit(JSONObject().put("kind", "response").put("id", id).put("ok", true).put("value", value))
    }

    fun failure(id: String, message: String, name: String = "NetworkError") {
        emit(JSONObject().put("kind", "response").put("id", id).put("ok", false).put("error", message).put("name", name))
    }
}
