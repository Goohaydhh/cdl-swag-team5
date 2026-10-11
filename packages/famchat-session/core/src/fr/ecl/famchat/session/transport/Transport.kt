package fr.ecl.famchat.session.transport

import fr.ecl.famchat.session.crypto.Tls
import fr.ecl.famchat.session.wire.Msg
import fr.ecl.famchat.session.wire.Tlv
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.DataInputStream
import java.io.IOException
import java.net.InetSocketAddress
import java.net.Proxy
import java.net.Socket
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocket

/**
 * Lien de transport fiable et ordonné (couche 4 + TLS). La couche session le considère
 * comme jetable : il peut tomber à tout moment, la session lui survit.
 */
interface Transport {
    val path: String        // nom du chemin : "lan", "ipv6", "tor"…
    val remote: String      // description de l'extrémité distante (journalisation)
    fun send(m: Msg)
    /** Bloquant. Lève IOException quand le lien est perdu. */
    fun receive(): Msg
    fun close()
    fun setReadTimeout(ms: Int)
}

class SocketTransport(private val socket: Socket, override val path: String) : Transport {
    private val input = DataInputStream(BufferedInputStream(socket.getInputStream()))
    private val output = BufferedOutputStream(socket.getOutputStream())
    private val writeLock = Any()
    @Volatile private var closed = false

    override val remote: String = socket.remoteSocketAddress?.toString() ?: "?"

    override fun send(m: Msg) {
        if (closed) throw IOException("transport fermé")
        synchronized(writeLock) { Tlv.write(output, Msg.toFrame(m)) }
    }

    override fun receive(): Msg = Msg.fromFrame(Tlv.read(input))

    override fun setReadTimeout(ms: Int) { socket.soTimeout = ms }

    override fun close() {
        if (closed) return
        closed = true
        try { socket.close() } catch (_: IOException) {}
    }
}

/**
 * Chemin candidat vers la tablette. priority : 0 = meilleur (LAN), puis IPv6, puis Tor.
 * connect() est appelé à chaque tentative : il peut donc relire une adresse fraîche
 * (résultat NSD, nouveau préfixe IPv6…).
 */
class PathCandidate(
    val name: String,
    val priority: Int,
    val connect: (timeoutMs: Int) -> Transport,
) {
    override fun toString() = "$name(p$priority)"
}

object Connectors {
    /**
     * Connexion TCP + TLS 1.3 épinglé.
     * @param proxy  null pour une connexion directe ; Proxy SOCKS pour Tor (127.0.0.1:9050).
     *               Avec un proxy SOCKS, l'hôte n'est pas résolu localement (indispensable
     *               pour une adresse .onion : c'est Tor qui la résout).
     */
    fun tls(path: String, host: String, port: Int, ctx: SSLContext, proxy: Proxy? = null): (Int) -> Transport =
        { timeoutMs ->
            val raw = if (proxy == null) Socket() else Socket(proxy)
            try {
                val addr = if (proxy == null) InetSocketAddress(host, port)
                           else InetSocketAddress.createUnresolved(host, port)
                raw.connect(addr, timeoutMs)
                raw.tcpNoDelay = true
                raw.keepAlive = true
                val ssl = ctx.socketFactory.createSocket(raw, host, port, true) as SSLSocket
                Tls.harden(ssl)
                ssl.soTimeout = timeoutMs
                ssl.startHandshake()             // échoue si l'empreinte ne correspond pas
                SocketTransport(ssl, path)
            } catch (e: Exception) {
                try { raw.close() } catch (_: IOException) {}
                throw if (e is IOException) e else IOException(e)
            }
        }
}
