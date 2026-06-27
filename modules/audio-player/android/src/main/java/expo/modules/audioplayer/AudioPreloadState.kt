package expo.modules.audioplayer

internal enum class AudioSourceType {
  PLAIN_PATH,
  FILE_URI,
  CONTENT_URI,
  UNSUPPORTED
}

internal fun classifyAudioSource(value: String): AudioSourceType {
  val scheme = URI_SCHEME_PREFIX.find(value)?.groupValues?.get(1)?.lowercase()
    ?: return AudioSourceType.PLAIN_PATH

  return when (scheme) {
    "file" -> AudioSourceType.FILE_URI
    "content" -> AudioSourceType.CONTENT_URI
    else -> AudioSourceType.UNSUPPORTED
  }
}

internal data class AudioLoadRequest(
  val id: String,
  val uri: String
)

internal enum class AudioLoadRequestField(val key: String) {
  ID("id"),
  URI("uri")
}

internal sealed interface AudioPreloadRequestValidation {
  data class Valid(
    val requests: List<AudioLoadRequest>
  ) : AudioPreloadRequestValidation

  data class Invalid(
    val index: Int,
    val field: AudioLoadRequestField
  ) : AudioPreloadRequestValidation
}

internal fun validateAudioLoadRequests(
  voices: List<Map<String, String>>
): AudioPreloadRequestValidation {
  val requests = ArrayList<AudioLoadRequest>(voices.size)
  for ((index, voice) in voices.withIndex()) {
    val id = voice[AudioLoadRequestField.ID.key]
    if (id.isNullOrBlank()) {
      return AudioPreloadRequestValidation.Invalid(index, AudioLoadRequestField.ID)
    }
    val uri = voice[AudioLoadRequestField.URI.key]
    if (uri.isNullOrBlank()) {
      return AudioPreloadRequestValidation.Invalid(index, AudioLoadRequestField.URI)
    }
    requests += AudioLoadRequest(id, uri)
  }
  return AudioPreloadRequestValidation.Valid(requests)
}

internal sealed interface AudioPreloadOutcome {
  data object Succeeded : AudioPreloadOutcome

  data class Cancelled(
    val reason: AudioPreloadCancellation
  ) : AudioPreloadOutcome

  data class DuplicateId(
    val id: String
  ) : AudioPreloadOutcome

  data class Failed(
    val id: String,
    val status: Int,
    val cause: Throwable?
  ) : AudioPreloadOutcome
}

internal sealed interface AudioPreloadRegisterResult {
  data object Pending : AudioPreloadRegisterResult
  data object Inactive : AudioPreloadRegisterResult

  data class Settled(
    val outcome: AudioPreloadOutcome
  ) : AudioPreloadRegisterResult
}

internal enum class AudioPreloadCancellation {
  NEW_PRELOAD,
  INIT,
  TEARDOWN
}

internal data class AudioPreloadHandle(
  val operationId: Long,
  val poolGeneration: Long
)

internal class AudioPreloadCoordinator<T>(
  private val discardSound: (poolGeneration: Long, id: String, soundId: Int) -> Unit,
  private val deleteTemporaryResource: (T) -> Unit
) {
  constructor(
    discardSound: (id: String, soundId: Int) -> Unit,
    deleteTemporaryResource: (T) -> Unit
  ) : this(
    discardSound = { _, id, soundId -> discardSound(id, soundId) },
    deleteTemporaryResource = deleteTemporaryResource
  )

  private data class ActivePreload<T>(
    val handle: AudioPreloadHandle,
    val batch: AudioPreloadBatch<T>,
    val stagedSounds: MutableMap<String, Int>,
    val onSettled: (AudioPreloadOutcome) -> Unit
  )

  private var activePreload: ActivePreload<T>? = null
  private val committedSounds = mutableMapOf<String, AudioSoundReference>()
  private var nextOperationId = 1L

  @Synchronized
  fun begin(
    ids: List<String>,
    poolGeneration: Long,
    onSettled: (AudioPreloadOutcome) -> Unit
  ): AudioPreloadHandle? {
    cancelActive(AudioPreloadCancellation.NEW_PRELOAD)
    val seenIds = mutableSetOf<String>()
    val duplicateId = ids.firstOrNull { !seenIds.add(it) }
    if (duplicateId != null) {
      onSettled(AudioPreloadOutcome.DuplicateId(duplicateId))
      return null
    }
    if (ids.isEmpty()) {
      onSettled(AudioPreloadOutcome.Succeeded)
      return null
    }

    val handle = AudioPreloadHandle(nextOperationId++, poolGeneration)
    activePreload = ActivePreload(
      handle = handle,
      batch = AudioPreloadBatch(
        ids.size,
        { id, soundId -> discardSound(poolGeneration, id, soundId) },
        deleteTemporaryResource
      ),
      stagedSounds = mutableMapOf(),
      onSettled = onSettled
    )
    return handle
  }

  @Synchronized
  fun register(
    handle: AudioPreloadHandle,
    id: String,
    soundId: Int,
    temporaryResource: T?
  ): AudioPreloadRegisterResult {
    val active = activePreload
    if (active?.handle != handle) {
      discardSound(handle.poolGeneration, id, soundId)
      temporaryResource?.let(deleteTemporaryResource)
      return AudioPreloadRegisterResult.Inactive
    }
    active.stagedSounds[id] = soundId
    val outcome = active.batch.register(id, soundId, temporaryResource)
      ?: return AudioPreloadRegisterResult.Pending
    settle(active, outcome)
    return AudioPreloadRegisterResult.Settled(outcome)
  }

  @Synchronized
  fun isActive(handle: AudioPreloadHandle): Boolean = activePreload?.handle == handle

  @Synchronized
  fun continueLoadingIfActive(
    handle: AudioPreloadHandle,
    onInactive: () -> Unit
  ): Boolean {
    if (activePreload?.handle == handle) {
      return true
    }
    onInactive()
    return false
  }

  private fun settle(active: ActivePreload<T>, outcome: AudioPreloadOutcome) {
    if (outcome == AudioPreloadOutcome.Succeeded) {
      val stagedSounds = active.stagedSounds.mapValues { (_, stagedSoundId) ->
        AudioSoundReference(active.handle.poolGeneration, stagedSoundId)
      }
      stagedSounds.forEach { (id, newSound) ->
        val oldSound = committedSounds[id]
        if (oldSound != null && oldSound != newSound) {
          discardSound(oldSound.poolGeneration, id, oldSound.soundId)
        }
      }
      committedSounds.putAll(stagedSounds)
    }
    activePreload = null
    active.onSettled(outcome)
  }

  @Synchronized
  fun onLoadComplete(
    handle: AudioPreloadHandle,
    soundId: Int,
    status: Int
  ) {
    val active = activePreload ?: return
    if (active.handle != handle) {
      return
    }
    val outcome = active.batch.onLoadComplete(soundId, status) ?: return
    settle(active, outcome)
  }

  @Synchronized
  fun soundFor(id: String): AudioSoundReference? = committedSounds[id]

  @Synchronized
  fun fail(
    handle: AudioPreloadHandle,
    id: String,
    status: Int,
    cause: Throwable? = null
  ) {
    val active = activePreload ?: return
    if (active.handle != handle) {
      return
    }
    val outcome = active.batch.fail(id, status, cause) ?: return
    settle(active, outcome)
  }

  @Synchronized
  fun reset(reason: AudioPreloadCancellation) {
    cancelActive(reason)
    committedSounds.clear()
  }

  @Synchronized
  fun cancelActive(reason: AudioPreloadCancellation) {
    val active = activePreload ?: return
    activePreload = null
    active.batch.fail(CANCELLED_ID, CANCELLED_STATUS)
    active.onSettled(AudioPreloadOutcome.Cancelled(reason))
  }

  private companion object {
    const val CANCELLED_ID = "<preload>"
    const val CANCELLED_STATUS = -1
  }
}

internal class AudioPreloadBatch<T>(
  private val expectedLoads: Int,
  private val discardSound: (id: String, soundId: Int) -> Unit,
  private val deleteTemporaryResource: (T) -> Unit
) {
  private data class Entry<T>(
    val id: String,
    val soundId: Int,
    val temporaryResource: T?,
    var completed: Boolean = false
  )

  private val entriesBySoundId = linkedMapOf<Int, Entry<T>>()
  private val earlyCompletionsBySoundId = linkedMapOf<Int, Int>()
  private var completedLoads = 0
  private var settled = false

  init {
    require(expectedLoads > 0) { "A preload batch must contain at least one load." }
  }

  fun register(id: String, soundId: Int, temporaryResource: T?): AudioPreloadOutcome? {
    check(!settled) { "Cannot register a load after the batch has settled." }
    val entry = Entry(id, soundId, temporaryResource)
    entriesBySoundId[soundId] = entry
    val earlyStatus = earlyCompletionsBySoundId.remove(soundId) ?: return null
    return complete(entry, earlyStatus)
  }

  fun onLoadComplete(soundId: Int, status: Int): AudioPreloadOutcome? {
    if (settled) {
      return null
    }

    val entry = entriesBySoundId[soundId]
    if (entry == null) {
      if (!earlyCompletionsBySoundId.containsKey(soundId)) {
        earlyCompletionsBySoundId[soundId] = status
      }
      return null
    }
    return complete(entry, status)
  }

  private fun complete(entry: Entry<T>, status: Int): AudioPreloadOutcome? {
    if (entry.completed) {
      return null
    }
    if (status != 0) {
      return fail(entry.id, status)
    }

    entry.completed = true
    completedLoads += 1
    if (completedLoads != expectedLoads) {
      return null
    }

    settled = true
    deleteTemporaryResources()
    return AudioPreloadOutcome.Succeeded
  }

  fun fail(id: String, status: Int, cause: Throwable? = null): AudioPreloadOutcome? {
    if (settled) {
      return null
    }

    settled = true
    entriesBySoundId.values.forEach { entry ->
      discardSound(entry.id, entry.soundId)
    }
    deleteTemporaryResources()
    return AudioPreloadOutcome.Failed(id, status, cause)
  }

  private fun deleteTemporaryResources() {
    entriesBySoundId.values.forEach { entry ->
      entry.temporaryResource?.let(deleteTemporaryResource)
    }
  }
}

private val URI_SCHEME_PREFIX = Regex("^([A-Za-z][A-Za-z0-9+.-]*):")
