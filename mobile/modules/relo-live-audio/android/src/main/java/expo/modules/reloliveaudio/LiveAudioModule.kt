package expo.modules.reloliveaudio

import android.Manifest
import android.content.pm.PackageManager
import android.util.Base64
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

class LiveAudioModule : Module() {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  private val sessionLock = Mutex()
  // Session IDs increase in the JS runtime paired with this module instance.
  private val cancelledThrough = AtomicInteger()

  @Volatile
  private var currentSession: LivePcmSession? = null

  @Volatile
  private var canStart = true

  override fun definition() = ModuleDefinition {
    Name("ReloLiveAudio")
    Events("microphoneChunk", "audioError")

    AsyncFunction("start") Coroutine { id: Int ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      withContext(Dispatchers.IO) {
        sessionLock.withLock {
          checkNotCancelled(id)
          check(canStart) { "Live audio requires the foreground" }
          check(currentSession == null) { "Another live audio session is active" }
          check(context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            "Microphone permission is required"
          }

          val session = LivePcmSession(
            id,
            onChunk = { base64 ->
              if (currentSession?.id == id && canStart && id > cancelledThrough.get()) {
                sendEvent("microphoneChunk", mapOf("sessionId" to id, "base64Pcm" to base64))
              }
            },
            onError = { message ->
              scope.launch { stopSession(id, message) }
            },
          )
          currentSession = session
          try {
            checkNotCancelled(id)
            check(canStart) { "Live audio requires the foreground" }
            session.start()
            checkNotCancelled(id)
          } catch (error: Exception) {
            currentSession = null
            withContext(NonCancellable) { session.close() }
            throw error
          }
        }
      }
    }

    AsyncFunction("play") Coroutine { id: Int, base64Pcm: String ->
      withContext(Dispatchers.IO) {
        check(base64Pcm.length <= 512_000) { "Audio chunk is too large" }
        val bytes = Base64.decode(base64Pcm, Base64.DEFAULT)
        check(bytes.size % 2 == 0) { "Audio chunk must contain complete PCM samples" }
        val samples = ShortArray(bytes.size / 2) { index ->
          val low = bytes[index * 2].toInt() and 0xff
          val high = bytes[index * 2 + 1].toInt() shl 8
          (low or high).toShort()
        }
        sessionFor(id).playback.enqueue(samples)
      }
    }

    AsyncFunction("finishPlayback") Coroutine { id: Int ->
      withContext(Dispatchers.IO) {
        currentSession?.takeIf { it.id == id }?.playback?.finish()
      }
    }

    AsyncFunction("clearPlayback") Coroutine { id: Int ->
      withContext(Dispatchers.IO) { sessionFor(id).playback.clear() }
    }

    AsyncFunction("stop") Coroutine { id: Int ->
      withContext(Dispatchers.IO) { stopSession(id) }
    }

    OnActivityEntersForeground { canStart = true }
    OnActivityEntersBackground {
      canStart = false
      currentSession?.id?.let { id ->
        scope.launch { stopSession(id, "Live audio paused because the app left the foreground") }
      }
    }
    OnDestroy {
      canStart = false
      scope.launch {
        stopSession()
        scope.cancel()
      }
    }
  }

  private fun sessionFor(id: Int): LivePcmSession =
    checkNotNull(currentSession?.takeIf { it.id == id }) { "Live audio session has ended" }

  private fun checkNotCancelled(id: Int) {
    check(id > cancelledThrough.get()) { "Live audio was cancelled" }
  }

  private suspend fun stopSession(id: Int? = null, message: String? = null) {
    // Fence off late startup before waiting for Android's recorder calls to return.
    if (id != null) cancelledThrough.updateAndGet { previous -> maxOf(previous, id) }
    sessionLock.withLock {
      val session = currentSession ?: return
      if (id != null && session.id != id) return
      currentSession = null
      withContext(NonCancellable) { session.close() }
      if (message != null) {
        sendEvent("audioError", mapOf("sessionId" to session.id, "message" to message))
      }
    }
  }
}
