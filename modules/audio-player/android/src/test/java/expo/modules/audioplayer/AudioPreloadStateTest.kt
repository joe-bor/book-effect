package expo.modules.audioplayer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AudioSourceTypeTest {
  @Test
  fun `classifies plain paths and supported URI schemes`() {
    assertEquals(AudioSourceType.PLAIN_PATH, classifyAudioSource("/data/user/0/app/files/effect.mp3"))
    assertEquals(AudioSourceType.FILE_URI, classifyAudioSource("file:///data/user/0/app/files/effect.mp3"))
    assertEquals(AudioSourceType.CONTENT_URI, classifyAudioSource("content://media/external/audio/1"))
  }

  @Test
  fun `classifies web and custom schemes as unsupported`() {
    assertEquals(AudioSourceType.UNSUPPORTED, classifyAudioSource("https://example.com/effect.mp3"))
    assertEquals(AudioSourceType.UNSUPPORTED, classifyAudioSource("http://example.com/effect.mp3"))
    assertEquals(AudioSourceType.UNSUPPORTED, classifyAudioSource("asset://effects/effect.mp3"))
  }
}

class AudioPreloadRequestValidatorTest {
  @Test
  fun `valid requests preserve every id and uri`() {
    assertEquals(
      AudioPreloadRequestValidation.Valid(
        listOf(
          AudioLoadRequest("first", "file:///effects/first.mp3"),
          AudioLoadRequest("second", "content://effects/second")
        )
      ),
      validateAudioLoadRequests(
        listOf(
          mapOf("id" to "first", "uri" to "file:///effects/first.mp3"),
          mapOf("id" to "second", "uri" to "content://effects/second")
        )
      )
    )
  }

  @Test
  fun `mixed request rejects the malformed entry`() {
    assertEquals(
      AudioPreloadRequestValidation.Invalid(index = 1, field = AudioLoadRequestField.URI),
      validateAudioLoadRequests(
        listOf(
          mapOf("id" to "valid", "uri" to "/effects/valid.mp3"),
          mapOf("id" to "missing-uri")
        )
      )
    )
  }

  @Test
  fun `fully malformed request reports the first invalid field`() {
    assertEquals(
      AudioPreloadRequestValidation.Invalid(index = 0, field = AudioLoadRequestField.ID),
      validateAudioLoadRequests(
        listOf(
          emptyMap(),
          mapOf("id" to "", "uri" to "")
        )
      )
    )
  }

  @Test
  fun `blank id is invalid`() {
    assertEquals(
      AudioPreloadRequestValidation.Invalid(index = 0, field = AudioLoadRequestField.ID),
      validateAudioLoadRequests(
        listOf(mapOf("id" to "  ", "uri" to "/effects/valid.mp3"))
      )
    )
  }

  @Test
  fun `blank uri is invalid`() {
    assertEquals(
      AudioPreloadRequestValidation.Invalid(index = 0, field = AudioLoadRequestField.URI),
      validateAudioLoadRequests(
        listOf(mapOf("id" to "valid", "uri" to "\t"))
      )
    )
  }

  @Test
  fun `empty request list is valid`() {
    assertEquals(
      AudioPreloadRequestValidation.Valid(emptyList()),
      validateAudioLoadRequests(emptyList())
    )
  }
}

class AudioPreloadBatchTest {
  @Test
  fun `successful batch keeps sounds and deletes temporary resources once all loads complete`() {
    val discardedSounds = mutableListOf<Pair<String, Int>>()
    val deletedResources = mutableListOf<String>()
    val batch = AudioPreloadBatch(
      expectedLoads = 2,
      discardSound = { id, soundId -> discardedSounds += id to soundId },
      deleteTemporaryResource = deletedResources::add
    )

    batch.register("first", 11, "first.tmp")
    batch.register("second", 12, "second.tmp")

    assertNull(batch.onLoadComplete(11, 0))
    assertEquals(AudioPreloadOutcome.Succeeded, batch.onLoadComplete(12, 0))
    assertEquals(emptyList<Pair<String, Int>>(), discardedSounds)
    assertEquals(listOf("first.tmp", "second.tmp"), deletedResources)
    assertNull(batch.onLoadComplete(12, 0))
  }

  @Test
  fun `failed batch discards completed and pending sounds and deletes all temporary resources`() {
    val discardedSounds = mutableListOf<Pair<String, Int>>()
    val deletedResources = mutableListOf<String>()
    val batch = AudioPreloadBatch(
      expectedLoads = 2,
      discardSound = { id, soundId -> discardedSounds += id to soundId },
      deleteTemporaryResource = deletedResources::add
    )

    batch.register("complete", 21, "complete.tmp")
    batch.register("pending", 22, "pending.tmp")
    assertNull(batch.onLoadComplete(21, 0))

    assertEquals(
      AudioPreloadOutcome.Failed("pending", 7, null),
      batch.onLoadComplete(22, 7)
    )
    assertEquals(listOf("complete" to 21, "pending" to 22), discardedSounds)
    assertEquals(listOf("complete.tmp", "pending.tmp"), deletedResources)
  }

  @Test
  fun `failed batch settles only once`() {
    val discardedSounds = mutableListOf<Pair<String, Int>>()
    val deletedResources = mutableListOf<String>()
    val batch = AudioPreloadBatch(
      expectedLoads = 1,
      discardSound = { id, soundId -> discardedSounds += id to soundId },
      deleteTemporaryResource = deletedResources::add
    )
    batch.register("effect", 31, "effect.tmp")

    val failure = IllegalStateException("provider failed")
    assertEquals(
      AudioPreloadOutcome.Failed("effect", -1, failure),
      batch.fail("effect", -1, failure)
    )
    assertNull(batch.fail("effect", -1))
    assertNull(batch.onLoadComplete(31, 0))
    assertEquals(listOf("effect" to 31), discardedSounds)
    assertEquals(listOf("effect.tmp"), deletedResources)
  }
}
