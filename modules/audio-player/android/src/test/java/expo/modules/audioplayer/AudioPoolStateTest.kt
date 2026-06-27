package expo.modules.audioplayer

import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AudioPoolStateTest {
  @Test
  fun `stale committed sound is not played after pool replacement`() {
    val played = mutableListOf<String>()
    val state = AudioPoolState<FakePool>()
    val first = state.install { FakePool("first") }
    val staleSound = AudioSoundReference(first.generation, 41)
    state.release(stopStream = { _, _ -> }, clearListener = {}, releasePool = {})
    state.install { FakePool("second") }

    val didPlay = state.play(staleSound) { pool, soundId ->
      played += "${pool.name}:$soundId"
      101
    }

    assertFalse(didPlay)
    assertEquals(emptyList<String>(), played)
  }

  @Test
  fun `stop all waits for an in-flight play and stops its stream`() {
    val events = mutableListOf<String>()
    val playEntered = CountDownLatch(1)
    val finishPlay = CountDownLatch(1)
    val stopEntered = CountDownLatch(1)
    val state = AudioPoolState<FakePool>()
    val handle = state.install { FakePool("pool") }
    val sound = AudioSoundReference(handle.generation, 42)
    val playThread = thread {
      state.play(sound) { _, _ ->
        events += "play"
        playEntered.countDown()
        finishPlay.await()
        102
      }
    }
    assertTrue(playEntered.await(1, TimeUnit.SECONDS))
    val stopThread = thread {
      state.stopAll { _, streamId ->
        events += "stop:$streamId"
        stopEntered.countDown()
      }
    }

    val stopEnteredBeforePlayFinished = stopEntered.await(100, TimeUnit.MILLISECONDS)
    finishPlay.countDown()
    playThread.join()
    stopThread.join()

    assertFalse(stopEnteredBeforePlayFinished)
    assertEquals(listOf("play", "stop:102"), events)
  }

  @Test
  fun `release waits for play and stops the stream before releasing`() {
    val events = mutableListOf<String>()
    val playEntered = CountDownLatch(1)
    val finishPlay = CountDownLatch(1)
    val releaseEntered = CountDownLatch(1)
    val state = AudioPoolState<FakePool>()
    val handle = state.install { FakePool("pool") }
    val sound = AudioSoundReference(handle.generation, 43)
    val playThread = thread {
      state.play(sound) { _, _ ->
        events += "play"
        playEntered.countDown()
        finishPlay.await()
        103
      }
    }
    assertTrue(playEntered.await(1, TimeUnit.SECONDS))
    val releaseThread = thread {
      state.release(
        stopStream = { _, streamId -> events += "stop:$streamId" },
        clearListener = {
          events += "clear-listener"
          releaseEntered.countDown()
        },
        releasePool = { events += "release" }
      )
    }

    val releaseEnteredBeforePlayFinished = releaseEntered.await(100, TimeUnit.MILLISECONDS)
    finishPlay.countDown()
    playThread.join()
    releaseThread.join()

    assertFalse(releaseEnteredBeforePlayFinished)
    assertEquals(listOf("play", "stop:103", "clear-listener", "release"), events)
  }

  @Test
  fun `stale listener install failure settles active preload and skips generation checked load`() {
    val events = mutableListOf<String>()
    val outcomes = mutableListOf<AudioPreloadOutcome>()
    val state = AudioPoolState<FakePool>()
    val staleHandle = state.install { FakePool("first") }
    val coordinator = AudioPreloadCoordinator<String>(
      discardSound = { generation, _, soundId ->
        state.discard(generation, soundId) { pool, id -> events += "unload:${pool.name}:$id" }
      },
      deleteTemporaryResource = {}
    )
    val preload = coordinator.begin(
      ids = listOf("effect"),
      poolGeneration = staleHandle.generation,
      onSettled = outcomes::add
    )!!
    state.release(stopStream = { _, _ -> }, clearListener = {}, releasePool = {})
    state.install { FakePool("second") }

    val listenerInstalled = state.setLoadCompleteListener(staleHandle) { pool ->
      events += "listener:${pool.name}"
    }
    val loadedSoundId = if (listenerInstalled) {
      state.load(staleHandle) { pool ->
        events += "load:${pool.name}"
        201
      }
    } else {
      null
    }
    val staleCause = IllegalStateException("SoundPool changed before preload could load.")
    if (loadedSoundId == null) {
      coordinator.fail(preload, "effect", STALE_POOL_STATUS, staleCause)
    } else {
      coordinator.register(preload, "effect", loadedSoundId, null)
    }

    assertFalse(listenerInstalled)
    assertNull(loadedSoundId)
    assertEquals(emptyList<String>(), events)
    assertEquals(listOf(AudioPreloadOutcome.Failed("effect", STALE_POOL_STATUS, staleCause)), outcomes)
  }

  @Test
  fun `release waits for an in-flight generation checked load and releases afterward`() {
    val events = mutableListOf<String>()
    val loadEntered = CountDownLatch(1)
    val finishLoad = CountDownLatch(1)
    val releaseEntered = CountDownLatch(1)
    val state = AudioPoolState<FakePool>()
    val handle = state.install { FakePool("pool") }
    val loadThread = thread {
      state.load(handle) { pool ->
        events += "load:${pool.name}"
        loadEntered.countDown()
        finishLoad.await()
        events += "load-complete:${pool.name}"
        202
      }
    }
    assertTrue(loadEntered.await(1, TimeUnit.SECONDS))
    val releaseThread = thread {
      state.release(
        stopStream = { _, streamId -> events += "stop:$streamId" },
        clearListener = {
          events += "clear-listener"
          releaseEntered.countDown()
        },
        releasePool = { events += "release" }
      )
    }

    val releaseEnteredBeforeLoadFinished = releaseEntered.await(100, TimeUnit.MILLISECONDS)
    finishLoad.countDown()
    loadThread.join()
    releaseThread.join()

    assertFalse(releaseEnteredBeforeLoadFinished)
    assertEquals(listOf("load:pool", "load-complete:pool", "clear-listener", "release"), events)
  }

  @Test
  fun `repeated release is harmless`() {
    val events = mutableListOf<String>()
    val state = AudioPoolState<FakePool>()
    val handle = state.install { FakePool("pool") }
    state.play(AudioSoundReference(handle.generation, 44)) { _, _ -> 104 }

    repeat(2) {
      state.release(
        stopStream = { _, streamId -> events += "stop:$streamId" },
        clearListener = { events += "clear-listener" },
        releasePool = { events += "release" }
      )
    }

    assertEquals(listOf("stop:104", "clear-listener", "release"), events)
  }

  @Test
  fun `discard unloads only from its matching pool generation`() {
    val events = mutableListOf<String>()
    val state = AudioPoolState<FakePool>()
    val first = state.install { FakePool("first") }
    state.discard(first.generation, 45) { pool, soundId -> events += "${pool.name}:$soundId" }
    state.release(stopStream = { _, _ -> }, clearListener = {}, releasePool = {})
    val second = state.install { FakePool("second") }

    state.discard(first.generation, 46) { pool, soundId -> events += "${pool.name}:$soundId" }
    state.discard(second.generation, 47) { pool, soundId -> events += "${pool.name}:$soundId" }

    assertEquals(listOf("first:45", "second:47"), events)
  }

  @Test
  fun `repeated lifecycle teardown cancels and releases exactly once`() {
    val events = mutableListOf<String>()
    var retainedTemporaryResource = true
    val poolState = AudioPoolState<FakePool>()
    val pool = poolState.install { FakePool("pool") }
    val coordinator = AudioPreloadCoordinator<String>(
      discardSound = { generation, _, soundId ->
        poolState.discard(generation, soundId) { _, id -> events += "unload:$id" }
      },
      deleteTemporaryResource = { events += "delete:$it" }
    )
    val preload = coordinator.begin(
      ids = listOf("pending"),
      poolGeneration = pool.generation,
      onSettled = { events += "settled:$it" }
    )!!
    coordinator.register(preload, "pending", 48, "pending.tmp")

    repeat(2) {
      teardownAudioPlayerState(
        coordinator = coordinator,
        poolState = poolState,
        reason = AudioPreloadCancellation.TEARDOWN,
        stopStream = { _, streamId -> events += "stop:$streamId" },
        clearListener = { events += "clear-listener" },
        releasePool = { events += "release" },
        deleteRetainedTemporaryResources = {
          if (retainedTemporaryResource) {
            events += "delete-retained"
            retainedTemporaryResource = false
          }
        }
      )
    }

    assertEquals(
      listOf(
        "unload:48",
        "delete:pending.tmp",
        "settled:${AudioPreloadOutcome.Cancelled(AudioPreloadCancellation.TEARDOWN)}",
        "clear-listener",
        "release",
        "delete-retained"
      ),
      events
    )
  }

  private data class FakePool(val name: String)

  private companion object {
    const val STALE_POOL_STATUS = -3
  }
}
