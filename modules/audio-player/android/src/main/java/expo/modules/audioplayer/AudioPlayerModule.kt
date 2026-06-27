package expo.modules.audioplayer

import android.content.Context
import android.content.res.AssetFileDescriptor
import android.media.AudioAttributes
import android.media.SoundPool
import android.net.Uri
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.IOException
import java.io.InputStream

class AudioPlayerModule : Module() {
  private val poolState = AudioPoolState<SoundPool>()
  private val retainedTemporaryFiles = mutableSetOf<File>()
  private val preloadCoordinator = AudioPreloadCoordinator<File>(
    discardSound = { generation, _, soundId ->
      poolState.discard(generation, soundId) { pool, id -> pool.unload(id) }
    },
    deleteTemporaryResource = ::deleteTemporaryFile
  )
  private var maxVoices = DEFAULT_MAX_VOICES

  override fun definition() = ModuleDefinition {
    Name("AudioPlayer")

    AsyncFunction("init") { options: Map<String, Any?>? ->
      teardownInternal(AudioPreloadCancellation.INIT)
      maxVoices = (options?.get("maxVoices") as? Number)?.toInt()?.coerceAtLeast(1) ?: DEFAULT_MAX_VOICES
      installSoundPool(maxVoices)
    }

    AsyncFunction("preload") { voices: List<Map<String, String>>, promise: Promise ->
      val loadRequests = when (val validation = validateAudioLoadRequests(voices)) {
        is AudioPreloadRequestValidation.Valid -> validation.requests
        is AudioPreloadRequestValidation.Invalid -> {
          preloadCoordinator.cancelActive(AudioPreloadCancellation.NEW_PRELOAD)
          promise.reject(
            "ERR_AUDIO_PRELOAD",
            "Audio preload request at index ${validation.index} has a missing or blank '${validation.field.key}' field.",
            null
          )
          return@AsyncFunction
        }
      }
      val context = appContext.reactContext ?: throw IllegalStateException("React context is unavailable.")
      val poolHandle = poolState.currentOrInstall { createSoundPool(maxVoices) }

      fun settlePreload(outcome: AudioPreloadOutcome?) {
        when (outcome) {
          null -> Unit
          AudioPreloadOutcome.Succeeded -> {
            clearLoadCompleteListener(poolHandle)
            promise.resolve()
          }
          is AudioPreloadOutcome.Cancelled -> {
            clearLoadCompleteListener(poolHandle)
            promise.reject(
              "ERR_AUDIO_PRELOAD",
              "Audio preload was cancelled by ${outcome.reason.name.lowercase()}.",
              null
            )
          }
          is AudioPreloadOutcome.DuplicateId -> {
            clearLoadCompleteListener(poolHandle)
            promise.reject(
              "ERR_AUDIO_PRELOAD",
              "Duplicate audio effect id '${outcome.id}' in preload request.",
              null
            )
          }
          is AudioPreloadOutcome.Failed -> {
            clearLoadCompleteListener(poolHandle)
            promise.reject(
              "ERR_AUDIO_PRELOAD",
              "Failed to preload audio effect '${outcome.id}' with SoundPool status ${outcome.status}.",
              outcome.cause
            )
          }
        }
      }

      val handle = preloadCoordinator.begin(
        ids = loadRequests.map { it.id },
        poolGeneration = poolHandle.generation,
        onSettled = ::settlePreload
      ) ?: return@AsyncFunction

      val listenerInstalled = poolState.setLoadCompleteListener(poolHandle) { currentPool ->
        currentPool.setOnLoadCompleteListener { callbackPool, soundId, status ->
          if (callbackPool === currentPool) {
            preloadCoordinator.onLoadComplete(handle, soundId, status)
          }
        }
      }
      if (!listenerInstalled) {
        preloadCoordinator.fail(
          handle,
          STALE_PRELOAD_ID,
          STALE_POOL_FAILURE,
          IllegalStateException("SoundPool changed before preload listener could be installed.")
        )
        return@AsyncFunction
      }

      for ((id, uri) in loadRequests) {
        if (!preloadCoordinator.isActive(handle)) {
          break
        }

        val preparedLoad = try {
          prepareSoundLoad(context, uri)
        } catch (exception: Exception) {
          preloadCoordinator.fail(handle, id, LOAD_EXCEPTION_FAILURE, exception)
          break
        }

        if (!preloadCoordinator.continueLoadingIfActive(handle) {
          preparedLoad.temporaryFile?.let(::deleteTemporaryFile)
          preparedLoad.closeQuietly()
        }) {
          break
        }

        val soundId = try {
          poolState.load(poolHandle) { pool -> preparedLoad.load(pool) }
        } catch (exception: Exception) {
          preparedLoad.temporaryFile?.let(::deleteTemporaryFile)
          preloadCoordinator.fail(handle, id, LOAD_EXCEPTION_FAILURE, exception)
          break
        } finally {
          preparedLoad.closeQuietly()
        }

        if (soundId == null) {
          preparedLoad.temporaryFile?.let(::deleteTemporaryFile)
          preloadCoordinator.fail(
            handle,
            id,
            STALE_POOL_FAILURE,
            IllegalStateException("SoundPool changed before audio effect '$id' could be loaded.")
          )
          break
        }

        if (soundId == 0) {
          preparedLoad.temporaryFile?.let(::deleteTemporaryFile)
          preloadCoordinator.fail(handle, id, IMMEDIATE_LOAD_FAILURE)
          break
        }

        when (preloadCoordinator.register(handle, id, soundId, preparedLoad.temporaryFile)) {
          AudioPreloadRegisterResult.Pending -> Unit
          AudioPreloadRegisterResult.Inactive -> break
          is AudioPreloadRegisterResult.Settled -> break
        }
      }
    }

    Function("play") { id: String ->
      val sound = preloadCoordinator.soundFor(id) ?: return@Function
      poolState.play(sound) { pool, soundId ->
        pool.play(soundId, FULL_VOLUME, FULL_VOLUME, STREAM_PRIORITY, NO_LOOP, NORMAL_RATE)
      }
    }

    Function("stopAll") {
      poolState.stopAll { pool, streamId -> pool.stop(streamId) }
    }

    AsyncFunction("teardown") {
      teardownInternal(AudioPreloadCancellation.TEARDOWN)
    }

    OnDestroy {
      teardownInternal(AudioPreloadCancellation.TEARDOWN)
    }
  }

  private fun prepareSoundLoad(context: Context, value: String): PreparedSoundLoad {
    val parsed = Uri.parse(value)
    return when (classifyAudioSource(value)) {
      AudioSourceType.PLAIN_PATH -> PreparedSoundLoad.Path(value)
      AudioSourceType.FILE_URI -> {
        val path = parsed.path ?: throw IOException("File URI does not contain a path.")
        PreparedSoundLoad.Path(path)
      }
      AudioSourceType.CONTENT_URI -> prepareContentSound(context, parsed)
      AudioSourceType.UNSUPPORTED -> throw IOException("Unsupported audio URI scheme: ${parsed.scheme}")
    }
  }

  private fun prepareContentSound(context: Context, uri: Uri): PreparedSoundLoad {
    val resolver = context.contentResolver
    val descriptor = resolver.openAssetFileDescriptor(uri, "r")
    if (descriptor != null) {
      if (descriptor.length > 0L) {
        return PreparedSoundLoad.Descriptor(descriptor)
      }

      descriptor.use {
        return it.createInputStream().use { input ->
          prepareCachedContent(context, input)
        }
      }
    }

    val input = resolver.openInputStream(uri)
      ?: throw IOException("Content provider returned no audio data for $uri.")
    return input.use { prepareCachedContent(context, it) }
  }

  private fun prepareCachedContent(
    context: Context,
    input: InputStream
  ): PreparedSoundLoad {
    val temporaryFile = File.createTempFile(TEMP_FILE_PREFIX, TEMP_FILE_SUFFIX, context.cacheDir)
    retainTemporaryFile(temporaryFile)

    try {
      temporaryFile.outputStream().use { output -> input.copyTo(output) }
      if (temporaryFile.length() <= 0L) {
        throw IOException("Content provider returned empty audio data.")
      }
      return PreparedSoundLoad.Path(temporaryFile.absolutePath, temporaryFile)
    } catch (exception: Exception) {
      deleteTemporaryFile(temporaryFile)
      throw exception
    }
  }

  private fun retainTemporaryFile(file: File) {
    synchronized(retainedTemporaryFiles) {
      retainedTemporaryFiles.add(file)
    }
  }

  private fun deleteTemporaryFile(file: File) {
    if (!file.exists() || file.delete()) {
      synchronized(retainedTemporaryFiles) {
        retainedTemporaryFiles.remove(file)
      }
    }
  }

  private fun deleteAllTemporaryFiles() {
    val files = synchronized(retainedTemporaryFiles) {
      retainedTemporaryFiles.toList()
    }
    files.forEach(::deleteTemporaryFile)
  }

  private sealed class PreparedSoundLoad {
    open val temporaryFile: File? = null

    abstract fun load(pool: SoundPool): Int

    open fun close() = Unit

    data class Path(
      val path: String,
      override val temporaryFile: File? = null
    ) : PreparedSoundLoad() {
      override fun load(pool: SoundPool): Int = pool.load(path, LOAD_PRIORITY)
    }

    class Descriptor(
      private val descriptor: AssetFileDescriptor
    ) : PreparedSoundLoad() {
      override fun load(pool: SoundPool): Int = pool.load(descriptor, LOAD_PRIORITY)

      override fun close() {
        descriptor.close()
      }
    }
  }

  private fun PreparedSoundLoad.closeQuietly() {
    try {
      close()
    } catch (_: IOException) {
    }
  }

  private fun installSoundPool(maxStreams: Int): AudioPoolHandle<SoundPool> {
    return poolState.install { createSoundPool(maxStreams) }
  }

  private fun clearLoadCompleteListener(handle: AudioPoolHandle<SoundPool>) {
    poolState.setLoadCompleteListener(handle) { pool -> pool.setOnLoadCompleteListener(null) }
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

  private fun teardownInternal(reason: AudioPreloadCancellation) {
    teardownAudioPlayerState(
      coordinator = preloadCoordinator,
      poolState = poolState,
      reason = reason,
      stopStream = { pool, streamId -> pool.stop(streamId) },
      clearListener = { pool -> pool.setOnLoadCompleteListener(null) },
      releasePool = { pool -> pool.release() },
      deleteRetainedTemporaryResources = ::deleteAllTemporaryFiles
    )
  }

  companion object {
    private const val DEFAULT_MAX_VOICES = 4
    private const val LOAD_PRIORITY = 1
    private const val FULL_VOLUME = 1.0f
    private const val STREAM_PRIORITY = 1
    private const val NO_LOOP = 0
    private const val NORMAL_RATE = 1.0f
    private const val IMMEDIATE_LOAD_FAILURE = -1
    private const val LOAD_EXCEPTION_FAILURE = -2
    private const val STALE_POOL_FAILURE = -3
    private const val STALE_PRELOAD_ID = "<preload>"
    private const val TEMP_FILE_PREFIX = "audio-player-"
    private const val TEMP_FILE_SUFFIX = ".cache"
  }
}
