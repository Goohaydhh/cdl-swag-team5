package fr.ecl.famchat.session

import java.io.IOException
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.concurrent.thread

/**
 * Relais TCP de test qui simule un chemin réseau entre le téléphone et la tablette.
 *  FORWARD   : le chemin fonctionne
 *  DOWN      : chemin coupé (connexions refusées / fermées) — ex. sortie du Wi-Fi
 *  BLACKHOLE : les paquets sont perdus mais aucune fermeture n'est signalée
 *              (cas réel : changement de réseau, NAT expiré, tunnel mort) — seul le
 *              keepalive applicatif permet de le détecter.
 */
class TcpRelay(@Volatile var targetPort: Int, val name: String) {
    enum class Mode { FORWARD, DOWN, BLACKHOLE }
    @Volatile var mode = Mode.FORWARD
        set(v) { field = v; if (v == Mode.DOWN) killAll() }

    private val ss = ServerSocket(0, 50, InetAddress.getLoopbackAddress())
    val port: Int get() = ss.localPort
    private val sockets = CopyOnWriteArrayList<Socket>()

    init {
        thread(name = "relay-$name", isDaemon = true) {
            while (!ss.isClosed) {
                val down = try { ss.accept() } catch (e: IOException) { break }
                if (mode == Mode.DOWN) { down.close(); continue }
                val up = try { Socket(InetAddress.getLoopbackAddress(), targetPort) } catch (e: IOException) { down.close(); continue }
                sockets += down; sockets += up
                pump(down, up); pump(up, down)
            }
        }
    }

    private fun pump(from: Socket, to: Socket) = thread(isDaemon = true) {
        val buf = ByteArray(16 * 1024)
        try {
            while (true) {
                val n = from.getInputStream().read(buf)
                if (n < 0) break
                if (mode == Mode.FORWARD) to.getOutputStream().write(buf, 0, n)   // BLACKHOLE : on jette
            }
        } catch (_: IOException) {
        } finally {
            try { from.close() } catch (_: IOException) {}
            try { to.close() } catch (_: IOException) {}
        }
    }

    fun killAll() { sockets.forEach { try { it.close() } catch (_: IOException) {} }; sockets.clear() }
    fun close() { ss.close(); killAll() }
}
