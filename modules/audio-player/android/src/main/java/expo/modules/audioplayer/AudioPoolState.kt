package expo.modules.audioplayer

internal data class AudioPoolHandle<P>(
  val generation: Long,
  val pool: P
)

internal data class AudioSoundReference(
  val poolGeneration: Long,
  val soundId: Int
)

internal class AudioPoolState<P> {
  private val lock = Any()
  private var currentPool: AudioPoolHandle<P>? = null
  private val activeStreamIds = linkedSetOf<Int>()
  private var nextGeneration = 1L

  fun install(createPool: () -> P): AudioPoolHandle<P> = synchronized(lock) {
    check(currentPool == null) { "Cannot install a pool before releasing the current pool." }
    AudioPoolHandle(nextGeneration++, createPool()).also { currentPool = it }
  }

  fun currentOrInstall(createPool: () -> P): AudioPoolHandle<P> = synchronized(lock) {
    currentPool ?: AudioPoolHandle(nextGeneration++, createPool()).also { currentPool = it }
  }

  fun play(
    sound: AudioSoundReference,
    playSound: (pool: P, soundId: Int) -> Int
  ): Boolean = synchronized(lock) {
    val handle = currentPool
    if (handle == null || handle.generation != sound.poolGeneration) {
      return@synchronized false
    }

    val streamId = playSound(handle.pool, sound.soundId)
    if (streamId == 0) {
      return@synchronized false
    }
    activeStreamIds.add(streamId)
    true
  }

  fun stopAll(stopStream: (pool: P, streamId: Int) -> Unit) = synchronized(lock) {
    val pool = currentPool?.pool
    if (pool != null) {
      activeStreamIds.forEach { streamId -> stopStream(pool, streamId) }
    }
    activeStreamIds.clear()
  }

  fun discard(
    poolGeneration: Long,
    soundId: Int,
    unloadSound: (pool: P, soundId: Int) -> Unit
  ): Boolean = synchronized(lock) {
    val handle = currentPool
    if (handle == null || handle.generation != poolGeneration) {
      return@synchronized false
    }
    unloadSound(handle.pool, soundId)
    true
  }

  fun load(
    handle: AudioPoolHandle<P>,
    loadSound: (pool: P) -> Int
  ): Int? = synchronized(lock) {
    val current = currentPool
    if (current == null || current.generation != handle.generation) {
      return@synchronized null
    }
    loadSound(current.pool)
  }

  fun setLoadCompleteListener(
    handle: AudioPoolHandle<P>,
    setListener: (pool: P) -> Unit
  ): Boolean = synchronized(lock) {
    val current = currentPool
    if (current == null || current.generation != handle.generation) {
      return@synchronized false
    }
    setListener(current.pool)
    true
  }

  fun release(
    stopStream: (pool: P, streamId: Int) -> Unit,
    clearListener: (pool: P) -> Unit,
    releasePool: (pool: P) -> Unit
  ) = synchronized(lock) {
    val handle = currentPool ?: return@synchronized
    activeStreamIds.forEach { streamId -> stopStream(handle.pool, streamId) }
    activeStreamIds.clear()
    clearListener(handle.pool)
    releasePool(handle.pool)
    currentPool = null
  }
}

internal fun <T, P> teardownAudioPlayerState(
  coordinator: AudioPreloadCoordinator<T>,
  poolState: AudioPoolState<P>,
  reason: AudioPreloadCancellation,
  stopStream: (pool: P, streamId: Int) -> Unit,
  clearListener: (pool: P) -> Unit,
  releasePool: (pool: P) -> Unit,
  deleteRetainedTemporaryResources: () -> Unit
) {
  coordinator.reset(reason)
  try {
    poolState.release(stopStream, clearListener, releasePool)
  } finally {
    deleteRetainedTemporaryResources()
  }
}
