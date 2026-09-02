package com.tarjetero.kiosk.tts

import android.content.Context
import android.speech.tts.TextToSpeech
import android.util.Log
import java.util.Locale

/**
 * WebView no implementa la Web Speech API (`speechSynthesis`), así que la
 * lectura de mensajes se hace con el motor TTS nativo de Android y se expone
 * a la página vía un puente JavaScript (ver MainActivity).
 */
class TtsSpeaker(context: Context) {

    private var engine: TextToSpeech? = null
    private var ready = false

    init {
        engine = TextToSpeech(context.applicationContext) { status ->
            if (status == TextToSpeech.SUCCESS) {
                ready = selectSpanishVoice()
            } else {
                Log.w(TAG, "No se pudo inicializar TextToSpeech (status=$status)")
            }
        }
    }

    private fun selectSpanishVoice(): Boolean {
        val currentEngine = engine ?: return false
        val candidates = listOf(Locale("es", "AR"), Locale("es", "ES"), Locale("es"))
        for (locale in candidates) {
            when (currentEngine.setLanguage(locale)) {
                TextToSpeech.LANG_AVAILABLE,
                TextToSpeech.LANG_COUNTRY_AVAILABLE,
                TextToSpeech.LANG_COUNTRY_VAR_AVAILABLE -> return true
            }
        }
        Log.w(TAG, "No hay voz/paquete de idioma español instalado en este dispositivo")
        return false
    }

    fun speak(text: String) {
        val currentEngine = engine
        if (currentEngine == null || !ready || text.isBlank()) {
            Log.w(TAG, "speak() ignorado (ready=$ready): \"$text\"")
            return
        }
        currentEngine.speak(text, TextToSpeech.QUEUE_FLUSH, null, "tarjetero-tts")
    }

    fun shutdown() {
        engine?.shutdown()
        engine = null
    }

    companion object {
        private const val TAG = "TtsSpeaker"
    }
}
