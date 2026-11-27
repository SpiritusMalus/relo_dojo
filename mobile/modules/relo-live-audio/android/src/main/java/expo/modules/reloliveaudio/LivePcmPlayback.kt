package expo.modules.reloliveaudio

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Build
import java.util.ArrayDeque
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout

internal class LivePcmPlayback(
  scope: CoroutineScope,
  onError: (String) -> Unit,
) {
  private class Chunk(val samples: ShortArray, var offset: Int = 0)
  private data class DrainTarget(val generation: Int, val frames: Long)

  private val lock = Any()
  private val track = createTrack()
  private val chunks = ArrayDeque<Chunk>()
  private val wake = Channel<Unit>(Channel.CONFLATED)
  private var queuedFrames = 0L
  private var contentThroughFrame = 0L
  private var paddedThroughFrame = 0L
  private var generation = 0
  private var closed = false

  private val writer = scope.launch {
    try {
      for (event in wake) {
        while (isActive) {
          val written = writeNext() ?: break
          if (written == 0) delay(8)
        }
      }
    } catch (error: CancellationException) {
      throw error
    } catch (error: Exception) {
      onError(error.message ?: "Audio playback failed")
    }
  }

  fun enqueue(samples: ShortArray) = synchronized(lock) {
    check(!closed) { "Live audio session has ended" }
    if (samples.isEmpty()) return@synchronized
    check(queuedFrames - playedFrames() + samples.size <= MAX_BUFFERED_FRAMES) {
      "Live audio playback queue is full"
    }
    append(samples)
    contentThroughFrame = queuedFrames
  }

  suspend fun finish() {
    val target = synchronized(lock) {
      if (closed || playedFrames() >= contentThroughFrame) return

      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S && paddedThroughFrame < contentThroughFrame) {
        // Older AudioTrack versions can require a full sink buffer to play a short tail.
        append(ShortArray(track.bufferSizeInFrames))
        paddedThroughFrame = contentThroughFrame
      }
      DrainTarget(generation, contentThroughFrame)
    }

    withTimeout(DRAIN_TIMEOUT_MS) {
      while (synchronized(lock) {
        !closed && generation == target.generation && playedFrames() < target.frames
      }) {
        delay(12)
      }
    }
  }

  fun clear() = synchronized(lock) {
    if (!closed) reset()
  }

  suspend fun close() {
    try {
      synchronized(lock) {
        closed = true
        reset()
      }
    } finally {
      wake.close()
      writer.cancelAndJoin()
      synchronized(lock) { track.release() }
    }
  }

  private fun reset() {
    ++generation
    chunks.clear()
    queuedFrames = 0
    contentThroughFrame = 0
    paddedThroughFrame = 0
    if (track.playState == AudioTrack.PLAYSTATE_PLAYING) track.pause()
    track.flush()
  }

  private fun playedFrames(): Long = track.playbackHeadPosition.toLong() and 0xffffffffL

  private fun append(samples: ShortArray) {
    chunks.addLast(Chunk(samples))
    queuedFrames += samples.size
    wake.trySend(Unit)
  }

  private fun writeNext(): Int? = synchronized(lock) {
    if (closed) return@synchronized null

    val chunk = chunks.peekFirst() ?: return@synchronized null
    if (track.playState != AudioTrack.PLAYSTATE_PLAYING) track.play()
    val written = track.write(
      chunk.samples,
      chunk.offset,
      chunk.samples.size - chunk.offset,
      AudioTrack.WRITE_NON_BLOCKING,
    )
    check(written >= 0) { "Audio playback write failed ($written)" }
    chunk.offset += written
    if (chunk.offset == chunk.samples.size) chunks.removeFirst()
    written
  }

  companion object {
    private const val PLAYBACK_RATE = 24_000
    private const val MAX_BUFFERED_FRAMES = PLAYBACK_RATE * 40L
    private const val DRAIN_TIMEOUT_MS = 45_000L

    private fun createTrack(): AudioTrack {
      val minBytes = AudioTrack.getMinBufferSize(
        PLAYBACK_RATE,
        AudioFormat.CHANNEL_OUT_MONO,
        AudioFormat.ENCODING_PCM_16BIT,
      )
      check(minBytes > 0) { "24 kHz audio playback is unavailable" }
      val track = AudioTrack.Builder()
        .setAudioAttributes(
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build(),
        )
        .setAudioFormat(
          AudioFormat.Builder()
            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
            .setSampleRate(PLAYBACK_RATE)
            .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
            .build(),
        )
        .setBufferSizeInBytes(minBytes)
        .setTransferMode(AudioTrack.MODE_STREAM)
        .build()

      try {
        check(track.state == AudioTrack.STATE_INITIALIZED) { "Audio speaker is unavailable" }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) track.setStartThresholdInFrames(1)
        return track
      } catch (error: Exception) {
        track.release()
        throw error
      }
    }
  }
}
