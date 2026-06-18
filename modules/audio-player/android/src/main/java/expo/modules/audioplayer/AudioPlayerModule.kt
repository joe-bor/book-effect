package expo.modules.audioplayer

import android.media.AudioAttributes
import android.media.SoundPool
import android.net.Uri
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class AudioPlayerModule : Module() {
  private var soundPool: SoundPool? = null
  private val soundIds = mutableMapOf<String, Int>()
  private val activeStreamIds = mutableSetOf<Int>()
  private var maxVoices = DEFAULT_MAX_VOICES

  override fun definition() = ModuleDefinition {
    Name("AudioPlayer")

    AsyncFunction("init") { options: Map<String, Any?>? ->
      teardownInternal()
      maxVoices = (options?.get("maxVoices") as? Number)?.toInt()?.coerceAtLeast(1) ?: DEFAULT_MAX_VOICES
      soundPool = createSoundPool(maxVoices)
    }

    AsyncFunction("preload") { voices: List<Map<String, String>>, promise: Promise ->
      val context = appContext.reactContext ?: throw IllegalStateException("React context is unavailable.")
      val pool = soundPool ?: createSoundPool(maxVoices).also { soundPool = it }
      val loadRequests = voices.mapNotNull { voice ->
        val id = voice["id"] ?: return@mapNotNull null
        val uri = voice["uri"] ?: return@mapNotNull null
        id to uri
      }

      if (loadRequests.isEmpty()) {
        promise.resolve()
        return@AsyncFunction
      }

      var pendingLoads = loadRequests.size
      var settled = false
      val pendingIdsBySoundId = mutableMapOf<Int, String>()

      fun rejectPreload(id: String, status: Int) {
        if (settled) {
          return
        }
        settled = true
        pendingIdsBySoundId.clear()
        pool.setOnLoadCompleteListener(null)
        promise.reject(
          "ERR_AUDIO_PRELOAD",
          "Failed to preload audio effect '$id' with SoundPool status $status.",
          null
        )
      }

      pool.setOnLoadCompleteListener { _, soundId, status ->
        val id = pendingIdsBySoundId.remove(soundId) ?: return@setOnLoadCompleteListener
        if (status != 0) {
          soundIds.remove(id)
          rejectPreload(id, status)
          return@setOnLoadCompleteListener
        }

        pendingLoads -= 1
        if (!settled && pendingLoads == 0) {
          settled = true
          pool.setOnLoadCompleteListener(null)
          promise.resolve()
        }
      }

      for ((id, uri) in loadRequests) {
        if (settled) {
          break
        }

        val soundId = pool.load(context, Uri.parse(uri), LOAD_PRIORITY)
        if (soundId == 0) {
          rejectPreload(id, IMMEDIATE_LOAD_FAILURE)
        } else {
          soundIds[id] = soundId
          pendingIdsBySoundId[soundId] = id
        }
      }
    }

    Function("play") { id: String ->
      val soundId = soundIds[id] ?: return@Function
      val streamId = soundPool?.play(soundId, FULL_VOLUME, FULL_VOLUME, STREAM_PRIORITY, NO_LOOP, NORMAL_RATE)
      if (streamId != null && streamId != 0) {
        activeStreamIds.add(streamId)
      }
    }

    Function("stopAll") {
      stopActiveStreams()
    }

    AsyncFunction("teardown") {
      teardownInternal()
    }
  }

  private fun createSoundPool(maxStreams: Int): SoundPool {
    val attributes = AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
      .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
      .build()

    return SoundPool.Builder()
      .setMaxStreams(maxStreams)
      .setAudioAttributes(attributes)
      .build()
  }

  private fun teardownInternal() {
    stopActiveStreams()
    soundPool?.setOnLoadCompleteListener(null)
    soundPool?.release()
    soundPool = null
    soundIds.clear()
  }

  private fun stopActiveStreams() {
    activeStreamIds.forEach { streamId ->
      soundPool?.stop(streamId)
    }
    activeStreamIds.clear()
  }

  companion object {
    private const val DEFAULT_MAX_VOICES = 4
    private const val LOAD_PRIORITY = 1
    private const val FULL_VOLUME = 1.0f
    private const val STREAM_PRIORITY = 1
    private const val NO_LOOP = 0
    private const val NORMAL_RATE = 1.0f
    private const val IMMEDIATE_LOAD_FAILURE = -1
  }
}
