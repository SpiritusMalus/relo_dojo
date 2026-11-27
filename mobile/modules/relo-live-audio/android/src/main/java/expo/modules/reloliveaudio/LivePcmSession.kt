package expo.modules.reloliveaudio

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Base64
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

internal class LivePcmSession(
  val id: Int,
  private val onChunk: (String) -> Unit,
  private val onError: (String) -> Unit,
) {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  private val recorder = createRecorder()
  val playback = try {
    LivePcmPlayback(scope, onError)
  } catch (error: Exception) {
    recorder.release()
    throw error
  }
  private var recorderJob: Job? = null

  fun start() {
    recorder.startRecording()
    check(recorder.recordingState == AudioRecord.RECORDSTATE_RECORDING) { "Microphone did not start" }
    recorderJob = scope.launch {
      val samples = ShortArray(CHUNK_FRAMES)
      val bytes = ByteArray(CHUNK_FRAMES * 2)
      var offset = 0

      try {
        while (isActive) {
          val read = recorder.read(samples, offset, samples.size - offset, AudioRecord.READ_NON_BLOCKING)
          check(read >= 0) { "Microphone read failed ($read)" }
          offset += read
          if (offset < samples.size) {
            delay(8)
            continue
          }

          samples.forEachIndexed { index, sample ->
            bytes[index * 2] = sample.toByte()
            bytes[index * 2 + 1] = (sample.toInt() shr 8).toByte()
          }
          onChunk(Base64.encodeToString(bytes, Base64.NO_WRAP))
          offset = 0
        }
      } catch (error: CancellationException) {
        throw error
      } catch (error: Exception) {
        onError(error.message ?: "Microphone capture failed")
      }
    }
  }

  suspend fun close() {
    try {
      recorderJob?.cancelAndJoin()
      if (recorder.recordingState == AudioRecord.RECORDSTATE_RECORDING) {
        runCatching { recorder.stop() }
      }
      recorder.release()
    } finally {
      try {
        playback.close()
      } finally {
        scope.cancel()
      }
    }
  }

  private companion object {
    const val RECORD_RATE = 16_000
    const val CHUNK_FRAMES = RECORD_RATE / 25 // 40 ms

    @SuppressLint("MissingPermission") // The module checks RECORD_AUDIO before constructing a session.
    fun createRecorder(): AudioRecord {
      val minBytes = AudioRecord.getMinBufferSize(
        RECORD_RATE,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT,
      )
      check(minBytes > 0) { "16 kHz microphone capture is unavailable" }

      val recorder = AudioRecord.Builder()
        .setAudioSource(MediaRecorder.AudioSource.VOICE_COMMUNICATION)
        .setAudioFormat(
          AudioFormat.Builder()
            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
            .setSampleRate(RECORD_RATE)
            .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
            .build(),
        )
        .setBufferSizeInBytes(maxOf(minBytes, CHUNK_FRAMES * 2 * 4))
        .build()
      if (recorder.state != AudioRecord.STATE_INITIALIZED) {
        recorder.release()
        error("Microphone is unavailable")
      }
      return recorder
    }
  }
}
