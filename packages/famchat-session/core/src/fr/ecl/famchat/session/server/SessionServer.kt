package fr.ecl.famchat.session.server

import fr.ecl.famchat.session.Log
import fr.ecl.famchat.session.NoLog
import fr.ecl.famchat.session.crypto.Crypto
import fr.ecl.famchat.session.crypto.Tls
import fr.ecl.famchat.session.store.Device
import fr.ecl.famchat.session.store.ServerStore
import fr.ecl.famchat.session.transport.SocketTransport
import fr.ecl.famchat.session.transport.Transport
import fr.ecl.famchat.session.wire.ErrorCode
import fr.ecl.famchat.session.wire.Event
import fr.ecl.famchat.session.wire.Msg
import fr.ecl.famchat.session.wire.PROTO_VERSION
import fr.ecl.famchat.session.wire.Role
import java.io.IOException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.util.UUID
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLServerSocket
import javax.net.ssl.SSLSocket
import kotlin.concurrent.thread

class ServerConfig(
    val port: Int = 8443,                       // 0 = port éphémère (tests)
    val bindAddress: InetAddress? = null,       // null = toutes interfaces (IPv4 + IPv6)
    val familyName: String = "Famille",
    val handshakeTimeoutMs: Int = 10_000,
    /** La tablette sonde chaque téléphone connecté : maintient les NAT/CGNAT et prouve la vivacité. */
    val pingIntervalMs: Long = 20_000,
    /** Sans réponse d'un téléphone pendant ce délai, sa connexion est fermée. */
    val idleTimeoutMs: Int = 50_000,
    val pairingLocalOnly: Boolean = true,
    val syncBatchLimit: Int = 5_000,
)

/** Vue « VLR » : où se trouve chaque appareil en ce moment. */
class SessionInfo(val deviceId: String, val sessionId: String, val role: Role, val remote: String, val since: Long)

/**
 * Serveur de session embarqué dans la tablette (le « proxy » local).
 *
 * Rôle comparable au HLR/VLR d'un réseau mobile : il connaît les abonnés (clés publiques
 * des téléphones appairés), authentifie chaque rattachement, enregistre le point
 * d'attache courant (connexion active) et achemine les événements. Une nouvelle connexion
 * authentifiée du même appareil remplace la précédente (équivalent d'un location update).
 *
 * Il écoute sur un seul port ; le même service est atteint par le LAN, l'IPv6 globale ou
 * Tor (le service onion redirige vers 127.0.0.1:port).
 */
class SessionServer(
    private val cfg: ServerConfig,
    private val ssl: SSLContext,
    private val fingerprint: ByteArray,
    private val store: ServerStore,
    private val log: Log = NoLog,
) {
    private val lock = Any()
    private val invites = HashMap<String, PairingInvite>()
    private val conns = HashMap<String, Conn>()          // deviceId -> connexion active
    private val listeners = CopyOnWriteArrayList<(Event) -> Unit>()
    private var serverSocket: SSLServerSocket? = null
    private val pinger = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "srv-ping").apply { isDaemon = true } }
    @Volatile private var running = false

    private inner class Conn(val t: Transport, val device: Device) {
        val writer: ExecutorService = Executors.newSingleThreadExecutor { r -> Thread(r, "tx-${device.id}").apply { isDaemon = true } }
        @Volatile var ready = false
        @Volatile var closed = false
        lateinit var sessionId: String
        val since = System.currentTimeMillis()

        /** Envoi asynchrone et ordonné : un téléphone lent ne bloque jamais les autres. */
        fun send(m: Msg) {
            if (closed) return
            writer.execute {
                try { t.send(m) } catch (e: IOException) { close("écriture : ${e.message}") }
            }
        }
        fun close(reason: String) {
            if (closed) return
            closed = true
            log.d("srv", "fermeture ${device.id} (${t.path} ${t.remote}) : $reason")
            writer.execute { t.close() }
            writer.shutdown()
        }
    }

    // ---------------------------------------------------------------------------------------
    // API publique (utilisée par l'interface de la tablette)
    // ---------------------------------------------------------------------------------------

    fun start(): Int {
        val ss = ssl.serverSocketFactory.createServerSocket() as SSLServerSocket
        ss.reuseAddress = true
        ss.enabledProtocols = Tls.PROTOCOLS
        ss.bind(InetSocketAddress(cfg.bindAddress, cfg.port))
        serverSocket = ss
        running = true
        thread(name = "srv-accept", isDaemon = true) { acceptLoop(ss) }
        // Seule horloge du système : un PING périodique vers chaque téléphone connecté.
        pinger.scheduleAtFixedRate({
            synchronized(lock) { conns.values.filter { it.ready }.forEach { it.send(Msg.Ping(System.currentTimeMillis())) } }
        }, cfg.pingIntervalMs, cfg.pingIntervalMs, TimeUnit.MILLISECONDS)
        log.d("srv", "écoute sur le port ${ss.localPort}")
        return ss.localPort
    }

    fun stop() {
        running = false
        pinger.shutdownNow()
        try { serverSocket?.close() } catch (_: IOException) {}
        synchronized(lock) { conns.values.forEach { it.close("arrêt du serveur") }; conns.clear() }
    }

    fun createPairingInvite(role: Role, endpoints: List<String>, ttlMs: Long = 120_000): PairingInvite {
        require(role == Role.ADMIN || role == Role.PARENT) { "seuls des téléphones parents s'appairent" }
        val inv = PairingInvite(Crypto.randomToken(16), role, System.currentTimeMillis() + ttlMs,
            fingerprint, endpoints, cfg.familyName)
        synchronized(lock) { invites[inv.token] = inv }
        return inv
    }

    /** Révocation immédiate : la connexion en cours est coupée, toute reconnexion échouera. */
    fun revoke(deviceId: String) {
        synchronized(lock) {
            val d = store.device(deviceId) ?: return
            store.putDevice(Device(d.id, d.publicKey, d.role, d.name, d.pairedAt, revoked = true))
            conns.remove(deviceId)?.let {
                it.send(Msg.Error(ErrorCode.UNKNOWN_DEVICE, "appareil révoqué", null))
                it.close("révoqué")
            }
        }
    }

    /** Émission depuis l'interface locale de la tablette (l'enfant). */
    fun submitLocal(kind: String, payload: ByteArray, role: Role = Role.CHILD, eventId: String = UUID.randomUUID().toString()): Event? {
        if (!RolePolicy.allowed(role, kind)) return null
        synchronized(lock) {
            val e = store.append("tablet", eventId, kind, payload, System.currentTimeMillis())
            broadcast(e)
            return e
        }
    }

    /**
     * Publie un état de la tablette aux parents (ex. TabletStatus.APP_CLOSED). C'est un
     * événement du journal : un téléphone hors ligne le reçoit à sa prochaine connexion.
     */
    fun publishStatus(text: String) = submitLocal(TabletStatus.KIND, text.toByteArray(), Role.SYSTEM)

    /** Publie les extrémités courantes (ex. nouveau préfixe IPv6) aux téléphones. */
    fun publishEndpoints(endpoints: List<String>) =
        submitLocal("sys.endpoints", endpoints.joinToString("\n").toByteArray(), Role.SYSTEM)

    fun addListener(l: (Event) -> Unit) { listeners += l }

    fun activeSessions(): List<SessionInfo> = synchronized(lock) {
        conns.values.filter { it.ready }.map { SessionInfo(it.device.id, it.sessionId, it.device.role, "${it.t.path} ${it.t.remote}", it.since) }
    }

    // ---------------------------------------------------------------------------------------
    // Traitement des connexions
    // ---------------------------------------------------------------------------------------

    private fun acceptLoop(ss: ServerSocket) {
        while (running) {
            val s = try { ss.accept() as SSLSocket } catch (e: IOException) { if (running) log.w("srv", "accept", e); continue }
            thread(name = "srv-conn", isDaemon = true) { handle(s) }
        }
    }

    private fun handle(s: SSLSocket) {
        val t = SocketTransport(s, "in")
        try {
            s.soTimeout = cfg.handshakeTimeoutMs
            s.startHandshake()
            when (val first = t.receive()) {
                is Msg.PairReq -> handlePairing(t, s.inetAddress, first)
                is Msg.Hello -> handleSession(t, first)
                else -> { t.send(Msg.Error(ErrorCode.BAD_PROTO, "message initial inattendu", null)); t.close() }
            }
        } catch (e: Exception) {
            log.d("srv", "connexion ${s.remoteSocketAddress} terminée : ${e.message}")
            t.close()
        }
    }

    private fun handlePairing(t: Transport, peer: InetAddress, req: Msg.PairReq) {
        fun refuse(why: String) {
            log.d("srv", "appairage refusé : $why")
            t.send(Msg.Error(ErrorCode.PAIRING_REFUSED, why, null)); t.close()
        }
        if (cfg.pairingLocalOnly && !NetPolicy.isLocal(peer)) return refuse("appairage uniquement depuis le réseau local")
        val inv = synchronized(lock) { invites.remove(req.token) }       // usage unique
            ?: return refuse("jeton inconnu ou déjà utilisé")
        if (System.currentTimeMillis() > inv.expiresAt) return refuse("invitation expirée")
        if (!Crypto.isValidEcPublicKey(req.publicKey)) return refuse("clé publique invalide")
        if (!Crypto.verify(req.publicKey, Crypto.pairTranscript(req.token, req.deviceId, fingerprint), req.proof))
            return refuse("preuve de possession invalide")
        synchronized(lock) {
            val existing = store.device(req.deviceId)
            if (existing != null && !existing.revoked) return refuse("identifiant d'appareil déjà utilisé")
            store.putDevice(Device(req.deviceId, req.publicKey, inv.role, req.displayName, System.currentTimeMillis()))
        }
        log.d("srv", "appareil appairé : ${req.deviceId} (${req.displayName}, ${inv.role})")
        t.send(Msg.PairOk(inv.role, cfg.familyName))
        t.close()
    }

    private fun handleSession(t: Transport, hello: Msg.Hello) {
        if (hello.proto != PROTO_VERSION) {
            t.send(Msg.Error(ErrorCode.BAD_PROTO, "version ${hello.proto} non supportée", null)); t.close(); return
        }
        val device = store.device(hello.deviceId)
        if (device == null || device.revoked) {
            t.send(Msg.Error(ErrorCode.UNKNOWN_DEVICE, "appareil inconnu ou révoqué", null)); t.close(); return
        }
        // --- Authentification par défi-réponse (liée au certificat de la tablette) ---
        val nonce = Crypto.random(32)
        t.send(Msg.Challenge(nonce))
        val auth = t.receive() as? Msg.Auth ?: throw IOException("AUTH attendu")
        if (!Crypto.verify(device.publicKey, Crypto.authTranscript(nonce, device.id, fingerprint), auth.signature)) {
            t.send(Msg.Error(ErrorCode.BAD_SIGNATURE, "signature invalide", null)); t.close(); return
        }

        val conn = Conn(t, device)
        synchronized(lock) {
            if (store.device(device.id)?.revoked == true) { t.close(); return }   // révoqué entre-temps
            val prev = store.sessionOf(device.id)
            val resumed = prev != null && prev == hello.prevSessionId
            conn.sessionId = if (resumed) prev!! else UUID.randomUUID().toString()
            if (!resumed) store.putSession(device.id, conn.sessionId)
            // Location update : la nouvelle attache remplace l'ancienne
            conns.put(device.id, conn)?.let {
                it.send(Msg.Error(ErrorCode.SUPERSEDED, "remplacée par ${t.path} ${t.remote}", null))
                it.close("remplacée par une nouvelle connexion")
            }
            val head = store.headSeq()
            conn.send(Msg.AuthOk(conn.sessionId, head, resumed, device.role))
            // Resynchronisation : tout ce qui suit le dernier point de synchronisation du téléphone.
            // Fait sous le verrou : aucun événement ne peut s'intercaler (ni trou, ni doublon).
            val missing = store.eventsAfter(hello.lastSeq, cfg.syncBatchLimit)
            missing.forEach { conn.send(Msg.EventMsg(it)) }
            conn.send(Msg.SyncDone(head))
            conn.ready = true
            log.d("srv", "session ${if (resumed) "reprise" else "nouvelle"} ${device.id} via ${t.remote}, " +
                    "lastSeq=${hello.lastSeq} → ${missing.size} événement(s) renvoyé(s)")
        }

        // --- Phase de transfert ---
        try {
            t.setReadTimeout(cfg.idleTimeoutMs)
            while (!conn.closed) {
                when (val m = t.receive()) {
                    is Msg.Submit -> onSubmit(conn, m)
                    is Msg.Pong -> {}           // preuve de vie : le délai d'inactivité repart
                    is Msg.Bye -> { conn.close("BYE : ${m.reason}"); break }
                    else -> log.d("srv", "message ignoré : $m")
                }
            }
        } catch (e: IOException) {
            conn.close("lien perdu : ${e.message}")
        } finally {
            synchronized(lock) { if (conns[device.id] === conn) conns.remove(device.id) }
        }
    }

    private fun onSubmit(conn: Conn, m: Msg.Submit) {
        if (!RolePolicy.allowed(conn.device.role, m.kind)) {
            conn.send(Msg.Error(ErrorCode.FORBIDDEN, "type ${m.kind} interdit pour ${conn.device.role}", m.clientMsgId))
            return
        }
        synchronized(lock) {
            // Idempotence : un Submit rejoué après une coupure ne crée pas de doublon.
            val existing = store.findEvent(conn.device.id, m.clientMsgId)
            if (existing != null) {
                conn.send(Msg.SubmitAck(m.clientMsgId, existing.seq))
                return
            }
            val e = store.append(conn.device.id, m.clientMsgId, m.kind, m.payload, System.currentTimeMillis())
            conn.send(Msg.SubmitAck(m.clientMsgId, e.seq))
            broadcast(e)
        }
    }

    /** Appelé sous le verrou. */
    private fun broadcast(e: Event) {
        for (c in conns.values) if (c.ready) c.send(Msg.EventMsg(e))
        for (l in listeners) try { l(e) } catch (ex: Exception) { log.w("srv", "listener", ex) }
    }
}
