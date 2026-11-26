package expo.modules.relolearningtransport

import android.content.Context
import android.net.ConnectivityManager
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.sharedobjects.SharedObject
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

class LearningTransportModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ReloLearningTransport")

    Class("Request", LearningRequest::class) {
      Constructor {
        return@Constructor LearningRequest(appContext)
      }

      AsyncFunction("send") Coroutine {
          request: LearningRequest, url: String, headers: Map<String, String>, body: String, timeoutMs: Int ->
        val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
        val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        withContext(Dispatchers.IO) {
          request.send(manager, URL(url), headers, body, timeoutMs)
        }
      }

      AsyncFunction("cancel") Coroutine { request: LearningRequest ->
        withContext(Dispatchers.IO) { request.cancel() }
      }
    }
  }
}

internal class LearningRequest(appContext: AppContext) : SharedObject(appContext) {
  private val cancelled = AtomicBoolean()
  private val activeConnection = AtomicReference<HttpURLConnection?>()

  fun send(
    manager: ConnectivityManager,
    url: URL,
    headers: Map<String, String>,
    body: String,
    timeoutMs: Int,
  ): Map<String, Any> {
    if (cancelled.get()) throw IOException("Request cancelled")
    // Bind DNS and the socket to the current default network, including a device VPN if present.
    // A connection from the previous network can stay in a process-wide pool after a reconnect.
    val network = manager.activeNetwork ?: throw IOException("No active network")
    val connection = network.openConnection(url) as HttpURLConnection
    activeConnection.set(connection)
    try {
      if (cancelled.get()) throw IOException("Request cancelled")
      connection.connectTimeout = minOf(5_000, timeoutMs)
      connection.readTimeout = timeoutMs
      connection.requestMethod = "POST"
      connection.instanceFollowRedirects = false
      connection.doOutput = true
      headers.forEach { (name, value) -> connection.setRequestProperty(name, value) }
      val payload = body.toByteArray(Charsets.UTF_8)
      connection.setFixedLengthStreamingMode(payload.size)
      connection.outputStream.use { it.write(payload) }
      val status = connection.responseCode
      val stream = if (status >= 400) connection.errorStream else connection.inputStream
      val responseBody = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
      return mapOf("status" to status, "body" to responseBody)
    } finally {
      if (activeConnection.compareAndSet(connection, null)) connection.disconnect()
    }
  }

  fun cancel() {
    cancelled.set(true)
    activeConnection.getAndSet(null)?.disconnect()
  }
}
