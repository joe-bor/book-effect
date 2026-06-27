package expo.modules.audioplayer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AudioPreloadCoordinatorTest {
  @Test
  fun `starting a preload cancels and rolls back the active preload`() {
    val discardedSounds = mutableListOf<Pair<String, Int>>()
    val deletedResources = mutableListOf<String>()
    val firstOutcomes = mutableListOf<AudioPreloadOutcome>()
    val coordinator = AudioPreloadCoordinator(
      discardSound = { id, soundId -> discardedSounds += id to soundId },
      deleteTemporaryResource = deletedResources::add
    )
    val first = coordinator.begin(
      ids = listOf("first"),
      poolGeneration = 1,
      onSettled = firstOutcomes::add
    )!!
    coordinator.register(first, "first", 41, "first.tmp")

    coordinator.begin(
      ids = listOf("second"),
      poolGeneration = 1,
      onSettled = {}
    )

    assertEquals(
      listOf(AudioPreloadOutcome.Cancelled(AudioPreloadCancellation.NEW_PRELOAD)),
      firstOutcomes
    )
    assertEquals(listOf("first" to 41), discardedSounds)
    assertEquals(listOf("first.tmp"), deletedResources)
  }

  @Test
  fun `temporary resources are retained until every load completes`() {
    val deletedResources = mutableListOf<String>()
    val outcomes = mutableListOf<AudioPreloadOutcome>()
    val coordinator = AudioPreloadCoordinator(
      discardSound = { _, _ -> },
      deleteTemporaryResource = deletedResources::add
    )
    val handle = coordinator.begin(
      ids = listOf("first", "second"),
      poolGeneration = 1,
      onSettled = outcomes::add
    )!!
    coordinator.register(handle, "first", 51, "first.tmp")
    coordinator.register(handle, "second", 52, "second.tmp")

    coordinator.onLoadComplete(handle, 51, 0)

    assertEquals(emptyList<AudioPreloadOutcome>(), outcomes)
    assertEquals(emptyList<String>(), deletedResources)

    coordinator.onLoadComplete(handle, 52, 0)

    assertEquals(listOf(AudioPreloadOutcome.Succeeded), outcomes)
    assertEquals(listOf("first.tmp", "second.tmp"), deletedResources)
  }

  @Test
  fun `caller loop stops before preparing the next load when its handle is cancelled`() {
    val preparedLoads = mutableListOf<String>()
    val discardedSounds = mutableListOf<Pair<String, Int>>()
    val deletedResources = mutableListOf<String>()
    val firstOutcomes = mutableListOf<AudioPreloadOutcome>()
    val coordinator = AudioPreloadCoordinator(
      discardSound = { id, soundId -> discardedSounds += id to soundId },
      deleteTemporaryResource = deletedResources::add
    )
    val first = coordinator.begin(
      ids = listOf("first", "second"),
      poolGeneration = 1,
      onSettled = firstOutcomes::add
    )!!

    fun prepareLoadAndRegister(id: String, soundId: Int): Boolean {
      if (!coordinator.isActive(first)) {
        return false
      }

      preparedLoads += id
      return when (coordinator.register(first, id, soundId, "$id.tmp")) {
        AudioPreloadRegisterResult.Pending -> true
        is AudioPreloadRegisterResult.Settled -> false
        AudioPreloadRegisterResult.Inactive -> false
      }
    }

    assertTrue(prepareLoadAndRegister("first", 55))
    coordinator.begin(
      ids = listOf("replacement"),
      poolGeneration = 1,
      onSettled = {}
    )

    assertFalse(prepareLoadAndRegister("second", 56))
    assertEquals(AudioPreloadRegisterResult.Inactive, coordinator.register(first, "late", 57, "late.tmp"))
    assertEquals(listOf("first"), preparedLoads)
    assertEquals(listOf(AudioPreloadOutcome.Cancelled(AudioPreloadCancellation.NEW_PRELOAD)), firstOutcomes)
    assertEquals(listOf("first" to 55, "late" to 57), discardedSounds)
    assertEquals(listOf("first.tmp", "late.tmp"), deletedResources)
  }

  @Test
  fun `caller loop cleans prepared load and skips native load when handle is cancelled after prepare`() {
    val loadedSounds = mutableListOf<Int>()
    val preparedResource = FakePreparedResource()
    val coordinator = AudioPreloadCoordinator<FakePreparedResource>(
      discardSound = { _, _ -> },
      deleteTemporaryResource = {}
    )
    val first = coordinator.begin(
      ids = listOf("effect"),
      poolGeneration = 1,
      onSettled = {}
    )!!

    fun prepare(): FakePreparedResource {
      coordinator.begin(
        ids = listOf("replacement"),
        poolGeneration = 1,
        onSettled = {}
      )
      return preparedResource
    }

    if (coordinator.isActive(first)) {
      val prepared = prepare()
      if (coordinator.continueLoadingIfActive(first) { prepared.cleanup() }) {
        loadedSounds += 58
      }
    }

    assertEquals(emptyList<Int>(), loadedSounds)
    assertEquals(true, preparedResource.deletedTemporaryFile)
    assertEquals(true, preparedResource.closed)
  }

  @Test
  fun `early successful load completion is applied when the load is registered`() {
    val deletedResources = mutableListOf<String>()
    val outcomes = mutableListOf<AudioPreloadOutcome>()
    val coordinator = AudioPreloadCoordinator(
      discardSound = { _, _ -> },
      deleteTemporaryResource = deletedResources::add
    )
    val handle = coordinator.begin(
      ids = listOf("effect"),
      poolGeneration = 1,
      onSettled = outcomes::add
    )!!

    coordinator.onLoadComplete(handle, 53, 0)
    coordinator.register(handle, "effect", 53, "effect.tmp")

    assertEquals(listOf(AudioPreloadOutcome.Succeeded), outcomes)
    assertEquals(listOf("effect.tmp"), deletedResources)
    assertEquals(AudioSoundReference(1, 53), coordinator.soundFor("effect"))
  }

  @Test
  fun `early failed load completion is applied when the load is registered`() {
    val discardedSounds = mutableListOf<Pair<String, Int>>()
    val deletedResources = mutableListOf<String>()
    val outcomes = mutableListOf<AudioPreloadOutcome>()
    val coordinator = AudioPreloadCoordinator(
      discardSound = { id, soundId -> discardedSounds += id to soundId },
      deleteTemporaryResource = deletedResources::add
    )
    val handle = coordinator.begin(
      ids = listOf("effect"),
      poolGeneration = 1,
      onSettled = outcomes::add
    )!!

    coordinator.onLoadComplete(handle, 54, 7)
    coordinator.register(handle, "effect", 54, "effect.tmp")

    assertEquals(listOf(AudioPreloadOutcome.Failed("effect", 7, null)), outcomes)
    assertEquals(listOf("effect" to 54), discardedSounds)
    assertEquals(listOf("effect.tmp"), deletedResources)
    assertNull(coordinator.soundFor("effect"))
  }

  @Test
  fun `callback from a cancelled pool generation is ignored`() {
    val deletedResources = mutableListOf<String>()
    val secondOutcomes = mutableListOf<AudioPreloadOutcome>()
    val coordinator = AudioPreloadCoordinator(
      discardSound = { _, _ -> },
      deleteTemporaryResource = deletedResources::add
    )
    val first = coordinator.begin(
      ids = listOf("effect"),
      poolGeneration = 1,
      onSettled = {}
    )!!
    coordinator.register(first, "effect", 61, "first.tmp")
    val second = coordinator.begin(
      ids = listOf("effect"),
      poolGeneration = 2,
      onSettled = secondOutcomes::add
    )!!
    coordinator.register(second, "effect", 61, "second.tmp")

    coordinator.onLoadComplete(first, 61, 0)

    assertEquals(emptyList<AudioPreloadOutcome>(), secondOutcomes)
    assertEquals(listOf("first.tmp"), deletedResources)
  }

  @Test
  fun `init and teardown reset cancel the active preload`() {
    listOf(
      AudioPreloadCancellation.INIT,
      AudioPreloadCancellation.TEARDOWN
    ).forEach { reason ->
      val discardedSounds = mutableListOf<Pair<String, Int>>()
      val deletedResources = mutableListOf<String>()
      val outcomes = mutableListOf<AudioPreloadOutcome>()
      val coordinator = AudioPreloadCoordinator(
        discardSound = { id, soundId -> discardedSounds += id to soundId },
        deleteTemporaryResource = deletedResources::add
      )
      val handle = coordinator.begin(
        ids = listOf("effect"),
        poolGeneration = 1,
        onSettled = outcomes::add
      )!!
      coordinator.register(handle, "effect", 71, "effect.tmp")

      coordinator.reset(reason)
      coordinator.onLoadComplete(handle, 71, 0)

      assertEquals(listOf(AudioPreloadOutcome.Cancelled(reason)), outcomes)
      assertEquals(listOf("effect" to 71), discardedSounds)
      assertEquals(listOf("effect.tmp"), deletedResources)
    }
  }

  @Test
  fun `duplicate IDs reject before a preload starts`() {
    val discardedSounds = mutableListOf<Pair<String, Int>>()
    val deletedResources = mutableListOf<String>()
    val outcomes = mutableListOf<AudioPreloadOutcome>()
    val coordinator = AudioPreloadCoordinator(
      discardSound = { id, soundId -> discardedSounds += id to soundId },
      deleteTemporaryResource = deletedResources::add
    )

    val handle = coordinator.begin(
      ids = listOf("duplicate", "duplicate"),
      poolGeneration = 1,
      onSettled = outcomes::add
    )

    assertNull(handle)
    assertEquals(listOf(AudioPreloadOutcome.DuplicateId("duplicate")), outcomes)
    assertEquals(emptyList<Pair<String, Int>>(), discardedSounds)
    assertEquals(emptyList<String>(), deletedResources)
  }

  @Test
  fun `failed replacement preserves the committed sound mapping`() {
    val discardedSounds = mutableListOf<Pair<String, Int>>()
    val coordinator = AudioPreloadCoordinator<String>(
      discardSound = { id, soundId -> discardedSounds += id to soundId },
      deleteTemporaryResource = {}
    )
    val initial = coordinator.begin(
      ids = listOf("effect"),
      poolGeneration = 1,
      onSettled = {}
    )!!
    coordinator.register(initial, "effect", 81, null)
    coordinator.onLoadComplete(initial, 81, 0)
    val replacement = coordinator.begin(
      ids = listOf("effect"),
      poolGeneration = 1,
      onSettled = {}
    )!!
    coordinator.register(replacement, "effect", 82, null)

    assertEquals(AudioSoundReference(1, 81), coordinator.soundFor("effect"))

    coordinator.onLoadComplete(replacement, 82, 7)

    assertEquals(AudioSoundReference(1, 81), coordinator.soundFor("effect"))
    assertEquals(listOf("effect" to 82), discardedSounds)
  }

  @Test
  fun `successful replacement unloads the old sound before committing the new mapping`() {
    val discardedSounds = mutableListOf<Pair<String, Int>>()
    val coordinator = AudioPreloadCoordinator<String>(
      discardSound = { id, soundId -> discardedSounds += id to soundId },
      deleteTemporaryResource = {}
    )
    val initial = coordinator.begin(
      ids = listOf("effect"),
      poolGeneration = 1,
      onSettled = {}
    )!!
    coordinator.register(initial, "effect", 91, null)
    coordinator.onLoadComplete(initial, 91, 0)
    val replacement = coordinator.begin(
      ids = listOf("effect"),
      poolGeneration = 1,
      onSettled = {}
    )!!
    coordinator.register(replacement, "effect", 92, null)

    assertEquals(AudioSoundReference(1, 91), coordinator.soundFor("effect"))

    coordinator.onLoadComplete(replacement, 92, 0)

    assertEquals(AudioSoundReference(1, 92), coordinator.soundFor("effect"))
    assertEquals(listOf("effect" to 91), discardedSounds)
  }

  @Test
  fun `reset clears committed sound mappings`() {
    val coordinator = AudioPreloadCoordinator<String>(
      discardSound = { _, _ -> },
      deleteTemporaryResource = {}
    )
    val handle = coordinator.begin(
      ids = listOf("effect"),
      poolGeneration = 1,
      onSettled = {}
    )!!
    coordinator.register(handle, "effect", 101, null)
    coordinator.onLoadComplete(handle, 101, 0)

    coordinator.reset(AudioPreloadCancellation.INIT)

    assertNull(coordinator.soundFor("effect"))
  }

  @Test
  fun `explicit load failure rolls back and settles the active preload`() {
    val discardedSounds = mutableListOf<Pair<String, Int>>()
    val deletedResources = mutableListOf<String>()
    val outcomes = mutableListOf<AudioPreloadOutcome>()
    val coordinator = AudioPreloadCoordinator(
      discardSound = { id, soundId -> discardedSounds += id to soundId },
      deleteTemporaryResource = deletedResources::add
    )
    val handle = coordinator.begin(
      ids = listOf("first", "broken"),
      poolGeneration = 1,
      onSettled = outcomes::add
    )!!
    coordinator.register(handle, "first", 111, "first.tmp")
    val cause = IllegalStateException("provider failed")

    coordinator.fail(handle, "broken", -2, cause)
    coordinator.fail(handle, "broken", -2, cause)

    assertEquals(listOf(AudioPreloadOutcome.Failed("broken", -2, cause)), outcomes)
    assertEquals(listOf("first" to 111), discardedSounds)
    assertEquals(listOf("first.tmp"), deletedResources)
  }

  @Test
  fun `load registered after cancellation is discarded`() {
    val discardedSounds = mutableListOf<Pair<String, Int>>()
    val deletedResources = mutableListOf<String>()
    val coordinator = AudioPreloadCoordinator(
      discardSound = { id, soundId -> discardedSounds += id to soundId },
      deleteTemporaryResource = deletedResources::add
    )
    val cancelled = coordinator.begin(
      ids = listOf("cancelled"),
      poolGeneration = 1,
      onSettled = {}
    )!!
    coordinator.begin(
      ids = listOf("active"),
      poolGeneration = 1,
      onSettled = {}
    )

    coordinator.register(cancelled, "cancelled", 121, "late.tmp")

    assertEquals(listOf("cancelled" to 121), discardedSounds)
    assertEquals(listOf("late.tmp"), deletedResources)
  }

  @Test
  fun `cancelling an invalid new request preserves committed sounds`() {
    val discardedSounds = mutableListOf<Pair<String, Int>>()
    val outcomes = mutableListOf<AudioPreloadOutcome>()
    val coordinator = AudioPreloadCoordinator<String>(
      discardSound = { id, soundId -> discardedSounds += id to soundId },
      deleteTemporaryResource = {}
    )
    val committed = coordinator.begin(
      ids = listOf("committed"),
      poolGeneration = 1,
      onSettled = {}
    )!!
    coordinator.register(committed, "committed", 131, null)
    coordinator.onLoadComplete(committed, 131, 0)
    val active = coordinator.begin(
      ids = listOf("pending"),
      poolGeneration = 1,
      onSettled = outcomes::add
    )!!
    coordinator.register(active, "pending", 132, null)

    coordinator.cancelActive(AudioPreloadCancellation.NEW_PRELOAD)

    assertEquals(
      listOf(AudioPreloadOutcome.Cancelled(AudioPreloadCancellation.NEW_PRELOAD)),
      outcomes
    )
    assertEquals(AudioSoundReference(1, 131), coordinator.soundFor("committed"))
    assertEquals(listOf("pending" to 132), discardedSounds)
  }

  @Test
  fun `committed sound includes its pool generation`() {
    val coordinator = AudioPreloadCoordinator<String>(
      discardSound = { _, _ -> },
      deleteTemporaryResource = {}
    )
    val preload = coordinator.begin(
      ids = listOf("effect"),
      poolGeneration = 7,
      onSettled = {}
    )!!
    coordinator.register(preload, "effect", 141, null)
    coordinator.onLoadComplete(preload, 141, 0)

    assertEquals(AudioSoundReference(poolGeneration = 7, soundId = 141), coordinator.soundFor("effect"))
  }

  private class FakePreparedResource {
    var deletedTemporaryFile = false
      private set
    var closed = false
      private set

    fun cleanup() {
      deletedTemporaryFile = true
      closed = true
    }
  }
}
