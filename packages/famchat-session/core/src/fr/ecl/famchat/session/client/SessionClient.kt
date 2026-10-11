package fr.ecl.famchat.session.client

import fr.ecl.famchat.session.Log
import fr.ecl.famchat.session.NoLog
import fr.ecl.famchat.session.crypto.Crypto
import fr.ecl.famchat.session.crypto.DeviceSigner
import fr.ecl.famchat.session.store.ClientStore
import fr.ecl.famchat.session.store.OutboxItem
import fr.ecl.famchat.session.transport.EndpointBook
import fr.ecl.famchat.session.transport.PathCandidate
import fr.ecl.famchat.session.transport.Paths
import fr.ecl.famchat.session.transport.Transport
import fr.ecl.famchat.session.wire.ErrorCode
import fr.ecl.famchat.session.wire.Event
import fr.ecl.famchat.session.wire.Msg
import fr.ecl.famchat.session.wire.PROTO_VERSION
import fr.ecl.famchat.session.wire.ProtocolException
import java.io.IOException
import java.util.UUID
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/** OFFLINE → CONNECTING → ONLINE ; CLOSED = arrêt par l'utilisateur ou erreur fatale. */
enum class SessionState { OFFLINE, CONNECTING, ONLINE, CLOSED }

class ClientConfig(
    val deviceId: String,
    val signer: DeviceSigner,
    val serverFingerprint: ByteArray,
    val connectTimeoutMs: Int = 5_000,
    /** La tablette envoie un PING toutes les 20 s : sans aucune trame pendant ce délai, le lien est mort. */
    val readTimeoutMs: Int = 50_000,
    /** Délais entre deux tentatives (le dernier se répète). Un changement de réseau les court-circuite. */
    val retryDelaysMs: List<Long> = listOf(0, 1_000, 2_000, 5_000, 10_000, 30_000),
)

/** Rappels exécutés sur le fil de session : côté Android, repostez vers le thread UI. */
interface SessionListener {
    fun onState(state: SessionState, path: String?) {}
    fun onEvent(e: Event) {}
    fun onSubmitted(clientMsgId: String, seq: Long) {}
    fun onRejected(clientMsgId: String, reason: String) {}
    fun onFatal(code: Int, reason: String) {}
}

private class FatalError(val code: Int, msg: String) : Exception(msg)

/**
 * Couche session du téléphone, active tant que l'application est ouverte (start/stop).
 *
 * Un seul fil exécute une boucle linéaire :
 *   se connecter (meilleur chemin) → s'authentifier → rattraper → recevoir… → lien perdu → recommencer
 *
 * Continuité de session : sessionId + lastSeq (point de synchronisation) + file d'attente
 * persistante + idempotence (clientMsgId). Aucune horloge côté téléphone : la vivacité est
 * prouvée par les PING de la tablette, et un lien muet est détecté par le délai de lecture.
 */
class SessionClient(
    private val cfg: ClientConfig,
    private val store: ClientStore,
    private val candidates: () -> List<PathCandidate>,
    private val listener: SessionListener,
    private val log: Log = NoLog,
    private val endpointBook: EndpointBook? = null,
) {
    @Volatile var state = SessionState.OFFLINE; private set
    @Volatile private var running = false
    @Volatile private var link: Transport? = null
    @Volatile private var online = false
    private val wake = LinkedBlockingQueue<Unit>()

    /** À l'ouverture de l'application. */
    fun start() {
        if (running) return
        running = true
        thread(name = "session", isDaemon = true) { loop() }
    }

    /** À la fermeture de l'application. */
    fun stop() {
        running = false
        link?.let { try { it.send(Msg.Bye("fermeture")) } catch (_: IOException) {}; it.close() }
        wake.offer(Unit)
    }

    /** Écrit d'abord sur le disque, envoie ensuite : un message n'est jamais perdu. */
    fun submit(kind: String, payload: ByteArray): String {
        val id = UUID.randomUUID().toString()
        store.outboxAdd(OutboxItem(id, kind, payload, System.currentTimeMillis()))
        if (online) link?.let { trySend(it, Msg.Submit(id, kind, payload)) }   // sinon : envoyé à la reconnexion
        return id
    }

    /** Wi-Fi ↔ 4G : on coupe le lien courant, la boucle repart aussitôt sur le meilleur chemin. */
    fun onNetworkChanged(reason: String) {
        log.d("session", "changement de réseau : $reason")
        link?.close()
        wake.offer(Unit)
    }

    // -----------------------------------------------------------------------------------

    private fun loop() {
        var attempt = 0
        while (running) {
            wake.clear()
            setState(SessionState.CONNECTING, null)
            val t = Paths.firstReachable(candidates(), cfg.connectTimeoutMs, log)
            if (t != null) {
                link = t
                try {
                    runSession(t) { attempt = 0 }
                } catch (f: FatalError) {
                    log.d("session", "erreur fatale ${f.code} : ${f.message}")
                    running = false
                    listener.onFatal(f.code, f.message ?: "")
                } catch (e: Exception) {
                    log.d("session", "lien ${t.path} perdu : ${e.message}")
                } finally {
                    online = false; link = null; t.close()
                }
            }
            if (!running) break
            setState(SessionState.OFFLINE, null)
            val delay = cfg.retryDelaysMs[minOf(attempt++, cfg.retryDelaysMs.size - 1)]
            if (delay > 0) wake.poll(delay, TimeUnit.MILLISECONDS)          // réveillé par onNetworkChanged
        }
        setState(SessionState.CLOSED, null)
    }

    /** Une session sur un lien : ne se termine que par une exception (lien perdu, BYE, erreur). */
    private fun runSession(t: Transport, onOnline: () -> Unit) {
        // 1. Authentification par défi-réponse, liée au certificat épinglé de la tablette
        t.setReadTimeout(cfg.connectTimeoutMs)
        t.send(Msg.Hello(cfg.deviceId, PROTO_VERSION, store.sessionId, store.lastSeq))
        val ch = next(t) as? Msg.Challenge ?: throw ProtocolException("CHALLENGE attendu")
        t.send(Msg.Auth(cfg.signer.sign(Crypto.authTranscript(ch.nonce, cfg.deviceId, cfg.serverFingerprint))))
        val ok = next(t) as? Msg.AuthOk ?: throw ProtocolException("AUTH_OK attendu")
        if (store.sessionId != ok.sessionId) store.sessionId = ok.sessionId
        log.d("session", "authentifié via ${t.path}, session ${if (ok.resumed) "reprise" else "nouvelle"}")

        // 2. Rattrapage puis temps réel
        t.setReadTimeout(cfg.readTimeoutMs)
        while (true) {
            when (val m = next(t)) {
                is Msg.EventMsg -> applyEvent(m.event)
                is Msg.SyncDone -> {
                    online = true; onOnline()
                    setState(SessionState.ONLINE, t.path)
                    store.outbox().forEach { t.send(Msg.Submit(it.id, it.kind, it.payload)) }
                }
                is Msg.SubmitAck -> { store.outboxRemove(m.clientMsgId); listener.onSubmitted(m.clientMsgId, m.seq) }
                is Msg.Ping -> t.send(Msg.Pong(m.t))
                is Msg.Bye -> throw IOException("BYE : ${m.reason}")
                else -> {}
            }
        }
    }

    /** Lecture d'une trame ; les erreurs envoyées par la tablette sont traitées ici. */
    private fun next(t: Transport): Msg {
        while (true) {
            val m = t.receive()
            if (m !is Msg.Error) return m
            when {
                ErrorCode.isFatal(m.code) -> throw FatalError(m.code, m.detail)
                m.code == ErrorCode.FORBIDDEN && m.ref != null -> {
                    store.outboxRemove(m.ref); listener.onRejected(m.ref, m.detail)
                }
                else -> throw IOException("erreur ${m.code} : ${m.detail}")
            }
        }
    }

    private fun applyEvent(e: Event) {
        if (e.seq <= store.lastSeq) return                       // déjà reçu
        store.applyEvent(e)
        if (e.origin == cfg.deviceId) store.outboxRemove(e.eventId)
        if (e.kind == "sys.endpoints") endpointBook?.update(e.text.lines().filter { it.isNotBlank() })
        listener.onEvent(e)
    }

    private fun trySend(t: Transport, m: Msg) { try { t.send(m) } catch (_: IOException) { t.close() } }

    private fun setState(s: SessionState, path: String?) {
        if (s == state) return
        state = s
        log.d("session", "→ $s${path?.let { " [$it]" } ?: ""}")
        listener.onState(s, path)
    }
}
