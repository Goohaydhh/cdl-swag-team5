package fr.ecl.famchat.session

import fr.ecl.famchat.session.client.ClientConfig
import fr.ecl.famchat.session.client.PairingClient
import fr.ecl.famchat.session.client.PairingRecord
import fr.ecl.famchat.session.client.SessionClient
import fr.ecl.famchat.session.client.SessionListener
import fr.ecl.famchat.session.client.SessionState
import fr.ecl.famchat.session.crypto.Crypto
import fr.ecl.famchat.session.crypto.DeviceSigner
import fr.ecl.famchat.session.crypto.SoftwareSigner
import fr.ecl.famchat.session.crypto.Tls
import fr.ecl.famchat.session.server.NetPolicy
import fr.ecl.famchat.session.server.PairingInvite
import fr.ecl.famchat.session.server.ServerConfig
import fr.ecl.famchat.session.server.SessionServer
import fr.ecl.famchat.session.server.TabletStatus
import fr.ecl.famchat.session.store.ClientStore
import fr.ecl.famchat.session.store.FileClientStore
import fr.ecl.famchat.session.store.FileServerStore
import fr.ecl.famchat.session.store.MemoryClientStore
import fr.ecl.famchat.session.store.MemoryServerStore
import fr.ecl.famchat.session.store.ServerStore
import fr.ecl.famchat.session.store.XmlExport
import fr.ecl.famchat.session.transport.Connectors
import fr.ecl.famchat.session.transport.EndpointBook
import fr.ecl.famchat.session.transport.PathCandidate
import fr.ecl.famchat.session.wire.ErrorCode
import fr.ecl.famchat.session.wire.Event
import fr.ecl.famchat.session.wire.Msg
import fr.ecl.famchat.session.wire.PROTO_VERSION
import fr.ecl.famchat.session.wire.Role
import fr.ecl.famchat.session.wire.Tlv
import java.io.File
import java.io.FileInputStream
import java.io.IOException
import java.net.InetAddress
import java.security.KeyStore
import java.util.Collections
import kotlin.system.exitProcess

// =========================================================================================
// Mini-harnais de test (aucune dépendance externe)
// =========================================================================================

object T {
    var passed = 0
    val failed = ArrayList<String>()
    val verbose = System.getenv("VERBOSE") == "1"

    val only: String? = System.getenv("ONLY")
    fun test(name: String, block: () -> Unit) {
        if (only != null && !name.contains(only)) return
        val t0 = System.currentTimeMillis()
        try {
            block()
            passed++
            println("  ✔ $name (${System.currentTimeMillis() - t0} ms)")
        } catch (e: Throwable) {
            failed += name
            println("  ✘ $name : ${e.message}")
            if (verbose) e.printStackTrace()
        }
    }

    fun check(cond: Boolean, msg: () -> String) { if (!cond) throw AssertionError(msg()) }

    fun await(what: String, timeoutMs: Long = 10_000, cond: () -> Boolean) {
        val end = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < end) { if (cond()) return; Thread.sleep(20) }
        throw AssertionError("délai dépassé : $what")
    }
}

val LOG: Log = if (T.verbose) StdoutLog() else NoLog

// =========================================================================================
// Environnement : tablette (serveur) + téléphones
// =========================================================================================

class Recorder : SessionListener {
    val events: MutableList<Event> = Collections.synchronizedList(ArrayList())
    val states: MutableList<String> = Collections.synchronizedList(ArrayList())
    @Volatile var path: String? = null
    val rejected: MutableList<String> = Collections.synchronizedList(ArrayList())
    @Volatile var fatal: Int? = null
    override fun onState(state: SessionState, path: String?) { states += "$state${path?.let { "[$it]" } ?: ""}"; this.path = path }
    override fun onEvent(e: Event) { events += e }
    override fun onRejected(clientMsgId: String, reason: String) { rejected += clientMsgId }
    override fun onFatal(code: Int, reason: String) { fatal = code }
    fun texts() = synchronized(events) { events.map { it.text } }
}

class Tablet(val dir: File, store: ServerStore? = null, port: Int = 0) {
    val ks: KeyStore = loadOrCreateKeystore(File(dir, "tablet.p12"))
    val fp: ByteArray = Tls.fingerprint(ks, "famchat")
    val store: ServerStore = store ?: MemoryServerStore()
    val server = SessionServer(
        ServerConfig(port = port, bindAddress = InetAddress.getLoopbackAddress(), familyName = "Famille Test",
            pingIntervalMs = 300, idleTimeoutMs = 3_000),
        Tls.serverContext(ks, PASS), fp, this.store, LOG,
    )
    val port = server.start()

    fun direct(name: String = "lan", prio: Int = 0) =
        PathCandidate(name, prio, Connectors.tls(name, "127.0.0.1", port, Tls.clientContext(fp)))

    fun via(r: TcpRelay, name: String, prio: Int) =
        PathCandidate(name, prio, Connectors.tls(name, "127.0.0.1", r.port, Tls.clientContext(fp)))

    fun pair(deviceId: String, role: Role, signer: DeviceSigner = SoftwareSigner.generate()): Pair<PairingRecord, DeviceSigner> {
        val inv = server.createPairingInvite(role, listOf("lan", "ip:127.0.0.1:$port"))
        val scanned = PairingInvite.parse(inv.toUri())          // aller-retour par le « QR code »
        val rec = PairingClient.pair(scanned, direct().connect(3_000), deviceId, signer, "Téléphone $deviceId")
        return rec to signer
    }

    companion object {
        val PASS = "changeit".toCharArray()
        /** Équivalent JVM de la génération du certificat auto-signé de la tablette. */
        fun loadOrCreateKeystore(f: File): KeyStore {
            if (!f.exists()) {
                f.parentFile.mkdirs()
                val p = ProcessBuilder(
                    "keytool", "-genkeypair", "-alias", "famchat", "-keyalg", "EC", "-groupname", "secp256r1",
                    "-sigalg", "SHA256withECDSA", "-dname", "CN=famchat-tablet", "-validity", "3650",
                    "-storetype", "PKCS12", "-keystore", f.path, "-storepass", "changeit", "-keypass", "changeit",
                ).redirectErrorStream(true).start()
                p.inputStream.readBytes()
                check(p.waitFor() == 0) { "keytool a échoué" }
            }
            return KeyStore.getInstance("PKCS12").apply { FileInputStream(f).use { load(it, PASS) } }
        }
    }
}

fun fastConfig(deviceId: String, signer: DeviceSigner, fp: ByteArray) = ClientConfig(
    deviceId = deviceId, signer = signer, serverFingerprint = fp,
    connectTimeoutMs = 1_000, readTimeoutMs = 1_000, retryDelaysMs = listOf(0, 100, 200, 400),
)

class Phone(
    val deviceId: String, signer: DeviceSigner, fp: ByteArray,
    val store: ClientStore = MemoryClientStore(),
    cands: () -> List<PathCandidate>,
    book: EndpointBook? = null,
) {
    val rec = Recorder()
    val client = SessionClient(fastConfig(deviceId, signer, fp), store, cands, rec, LOG, book)
    fun start() = apply { client.start() }
    fun awaitActive(path: String? = null, ms: Long = 10_000) =
        T.await("$deviceId ACTIF${path?.let { " via $it" } ?: ""}", ms) {
            client.state == SessionState.ONLINE && (path == null || rec.path == path)
        }
}

fun scratch(name: String): File {
    val base = File(System.getenv("SCRATCH") ?: System.getProperty("java.io.tmpdir"), "famchat-tests")
    return File(base, name).apply { deleteRecursively(); mkdirs() }
}

// =========================================================================================
// Scénarios
// =========================================================================================

fun main() {
    val keyDir = scratch("keys")
    println("\nFamChat — tests de la couche session\n")

    println("Protocole")
    T.test("codec TLV : aller-retour de tous les messages") {
        val msgs = listOf(
            Msg.Hello("d1", PROTO_VERSION, null, 42), Msg.Hello("d1", 1, "sess", 0),
            Msg.Challenge(Crypto.random(32)), Msg.Auth(byteArrayOf(1, 2, 3)),
            Msg.AuthOk("s", 7, true, Role.PARENT), Msg.SyncDone(7),
            Msg.PairReq("tok", "d", byteArrayOf(9), "Papa", byteArrayOf(8)), Msg.PairOk(Role.ADMIN, "Famille é"),
            Msg.Submit("id", "chat.group", "héllo".toByteArray()), Msg.SubmitAck("id", 3),
            Msg.EventMsg(Event(5, "id", "o", "k", byteArrayOf(), 99)), Msg.Ping(1), Msg.Pong(1),
            Msg.Bye("x"), Msg.Error(4, "non", "ref"), Msg.Error(1, "non", null),
        )
        for (m in msgs) {
            val back = Msg.fromFrame(Tlv.decode(Tlv.encode(Msg.toFrame(m))))
            T.check(back.javaClass == m.javaClass) { "type ${m.javaClass.simpleName}" }
            T.check(Tlv.encode(Msg.toFrame(back)).contentEquals(Tlv.encode(Msg.toFrame(m)))) { "contenu ${m.javaClass.simpleName}" }
        }
    }
    T.test("codec TLV : trame malformée rejetée proprement") {
        val bad = listOf(byteArrayOf(), byteArrayOf(1), byteArrayOf(1, 0, 1, 1, 0x7f, 0, 0, 0))
        for (b in bad) T.check(runCatching { Tlv.decode(b) }.isFailure) { "accepté : ${b.toList()}" }
        T.check(runCatching { Tlv.read((ByteArray(4) { 0x7f }).inputStream()) }.isFailure) { "taille géante acceptée" }
    }
    T.test("classification d'adresses (RFC 1918 / RFC 6598 / ULA)") {
        fun a(s: String) = InetAddress.getByName(s)
        T.check(NetPolicy.isLocal(a("192.168.1.20")) && NetPolicy.isLocal(a("fd12:3456::1")) && NetPolicy.isLocal(a("fe80::1"))) { "local" }
        T.check(!NetPolicy.isLocal(a("100.64.12.3")) && !NetPolicy.isLocal(a("2a01:cb00::1")) && !NetPolicy.isLocal(a("8.8.8.8"))) { "non local" }
        T.check(NetPolicy.classifyV4(a("100.100.1.1")) == "SHARED_RFC6598_CGNAT") { "CGNAT" }
        T.check(NetPolicy.classifyV4(a("100.128.0.1")) == "PUBLIC") { "borne haute /10" }
        T.check(NetPolicy.classifyV4(a("172.31.0.1")) == "PRIVATE_RFC1918" && NetPolicy.classifyV4(a("172.32.0.1")) == "PUBLIC") { "172.16/12" }
    }

    println("\nAppairage")
    T.test("appairage par QR : succès puis jeton à usage unique") {
        val tab = Tablet(keyDir)
        val inv = tab.server.createPairingInvite(Role.ADMIN, listOf("lan"))
        val signer = SoftwareSigner.generate()
        val rec = PairingClient.pair(PairingInvite.parse(inv.toUri()), tab.direct().connect(3_000), "papa", signer, "Papa")
        T.check(rec.role == Role.ADMIN && rec.familyName == "Famille Test") { "PairOk incorrect" }
        T.check(tab.store.device("papa") != null) { "appareil non enregistré" }
        val again = runCatching { PairingClient.pair(inv, tab.direct().connect(3_000), "intrus", SoftwareSigner.generate(), "X") }
        T.check(again.isFailure && again.exceptionOrNull()!!.message!!.contains("jeton")) { "jeton réutilisable !" }
        tab.server.stop()
    }
    T.test("appairage : invitation expirée refusée") {
        val tab = Tablet(keyDir)
        val inv = tab.server.createPairingInvite(Role.PARENT, listOf("lan"), ttlMs = 1)
        Thread.sleep(20)
        val forged = PairingInvite(inv.token, inv.role, Long.MAX_VALUE, inv.fingerprint, inv.endpoints, inv.familyName)
        val r = runCatching { PairingClient.pair(forged, tab.direct().connect(3_000), "x", SoftwareSigner.generate(), "X") }
        T.check(r.isFailure && r.exceptionOrNull()!!.message!!.contains("expirée")) { "expiration non vérifiée côté tablette" }
        tab.server.stop()
    }
    T.test("épinglage TLS : un faux certificat est refusé") {
        val tab = Tablet(keyDir)
        val wrongFp = Crypto.sha256("autre".toByteArray())
        val r = runCatching { Connectors.tls("lan", "127.0.0.1", tab.port, Tls.clientContext(wrongFp))(2_000) }
        T.check(r.isFailure) { "connexion acceptée avec une mauvaise empreinte" }
        tab.server.stop()
    }

    println("\nSession")
    T.test("échanges temps réel entre deux parents et la tablette") {
        val tab = Tablet(keyDir)
        val (_, sA) = tab.pair("papa", Role.ADMIN)
        val (_, sB) = tab.pair("maman", Role.PARENT)
        val a = Phone("papa", sA, tab.fp, cands = { listOf(tab.direct()) }).start()
        val b = Phone("maman", sB, tab.fp, cands = { listOf(tab.direct()) }).start()
        a.awaitActive("lan"); b.awaitActive("lan")
        repeat(3) { a.client.submit("chat.group", "papa-$it".toByteArray()) }
        tab.server.submitLocal("mustdo.done", "devoirs faits".toByteArray())
        T.await("4 événements chez maman") { b.rec.events.size == 4 }
        T.await("4 événements chez papa") { a.rec.events.size == 4 }
        T.await("file d'attente vide") { a.store.outbox().isEmpty() }
        T.check(a.rec.events.map { it.seq } == listOf(1L, 2, 3, 4)) { "ordre : ${a.rec.events}" }
        T.check(b.rec.texts().containsAll(listOf("papa-0", "papa-1", "papa-2", "devoirs faits"))) { b.rec.texts().toString() }
        T.check(tab.server.activeSessions().size == 2) { "VLR : ${tab.server.activeSessions().size}" }
        a.client.stop(); b.client.stop(); tab.server.stop()
    }

    T.test("coupure : messages émis hors ligne livrés une seule fois, rien de perdu, session reprise") {
        val tab = Tablet(keyDir)
        val (_, sA) = tab.pair("papa", Role.ADMIN)
        val (_, sB) = tab.pair("maman", Role.PARENT)
        val path = TcpRelay(tab.port, "4g")
        val a = Phone("papa", sA, tab.fp, cands = { listOf(tab.via(path, "ipv6", 1)) }).start()
        val b = Phone("maman", sB, tab.fp, cands = { listOf(tab.direct()) }).start()
        a.awaitActive(); b.awaitActive()
        a.client.submit("chat.group", "avant".toByteArray())
        T.await("avant reçu et acquitté") { b.rec.events.size == 1 && a.store.outbox().isEmpty() }
        val sid = a.store.sessionId

        path.mode = TcpRelay.Mode.DOWN                               // tunnel, ascenseur…
        T.await("papa détecte la coupure") { a.client.state != SessionState.ONLINE }
        repeat(3) { a.client.submit("chat.group", "hors-ligne-$it".toByteArray()) }
        repeat(2) { b.client.submit("chat.group", "maman-$it".toByteArray()) }
        tab.server.submitLocal("chat.private", "je suis rentré".toByteArray())
        Thread.sleep(600)
        T.check(a.store.outbox().size == 3) { "outbox=${a.store.outbox().size}" }

        path.mode = TcpRelay.Mode.FORWARD
        a.awaitActive()
        T.await("papa a tout reçu (7)") { a.rec.events.size == 7 }
        T.await("maman a tout reçu (7)") { b.rec.events.size == 7 }
        T.await("outbox vidée") { a.store.outbox().isEmpty() }
        Thread.sleep(300)
        val all = tab.store.eventsAfter(0)
        T.check(all.size == 7) { "doublon ou perte côté tablette : ${all.size}" }
        T.check(a.rec.events.map { it.seq } == (1L..7L).toList()) { "séquence papa : ${a.rec.events.map { it.seq }}" }
        T.check(a.store.sessionId == sid) { "la session n'a pas été reprise" }
        a.client.stop(); b.client.stop(); tab.server.stop(); path.close()
    }

    T.test("retour à la maison sous trafic continu : bascule IPv6 → LAN sans perte ni doublon") {
        val tab = Tablet(keyDir)
        val (_, sA) = tab.pair("papa", Role.ADMIN)
        val lan = TcpRelay(tab.port, "lan").apply { mode = TcpRelay.Mode.DOWN }
        val v6 = TcpRelay(tab.port, "v6")
        val a = Phone("papa", sA, tab.fp, cands = { listOf(tab.via(lan, "lan", 0), tab.via(v6, "ipv6", 1)) }).start()
        a.awaitActive("ipv6")
        // trafic continu des deux côtés pendant la bascule
        val run = java.util.concurrent.atomic.AtomicBoolean(true)
        val gen = Thread { var i = 0; while (run.get()) { tab.server.submitLocal("chat.private", "t-${i++}".toByteArray()); a.client.submit("chat.private", "p-$i".toByteArray()); Thread.sleep(15) } }
        gen.start()
        Thread.sleep(300)
        lan.mode = TcpRelay.Mode.FORWARD                              // le téléphone rejoint le Wi-Fi
        a.client.onNetworkChanged("Wi-Fi maison disponible")
        a.awaitActive("lan")
        Thread.sleep(300); run.set(false); gen.join()
        T.await("convergence") { a.store.outbox().isEmpty() && a.rec.events.size.toLong() == tab.store.headSeq() }
        T.check(a.rec.events.map { it.seq } == (1L..tab.store.headSeq()).toList()) { "trou ou doublon dans la séquence" }
        val sent = tab.store.eventsAfter(0).count { it.origin == "papa" }
        val ids = tab.store.eventsAfter(0).filter { it.origin == "papa" }.map { it.eventId }.toSet()
        T.check(sent == ids.size) { "doublon côté tablette" }
        a.client.stop(); tab.server.stop(); lan.close(); v6.close()
    }

    T.test("lien « trou noir » détecté (PING de la tablette absents), bascule vers le secours") {
        val tab = Tablet(keyDir)
        val (_, sA) = tab.pair("papa", Role.ADMIN)
        val lan = TcpRelay(tab.port, "lan")
        val tor = TcpRelay(tab.port, "tor")
        val a = Phone("papa", sA, tab.fp, cands = { listOf(tab.via(lan, "lan", 0), tab.via(tor, "tor", 3)) }).start()
        a.awaitActive("lan")
        lan.mode = TcpRelay.Mode.BLACKHOLE                            // plus rien ne passe, aucune fermeture
        val t0 = System.currentTimeMillis()
        a.awaitActive("tor", 8_000)
        val dt = System.currentTimeMillis() - t0
        tab.server.submitLocal("chat.private", "coucou".toByteArray())
        T.await("événement reçu via tor") { a.rec.texts().contains("coucou") }
        T.check(dt < 5_000) { "détection trop lente : $dt ms" }
        println("      (lien mort détecté et remplacé en $dt ms)")
        a.client.stop(); tab.server.stop(); lan.close(); tor.close()
    }

    T.test("changement de réseau : reconnexion immédiate sur le meilleur chemin") {
        val tab = Tablet(keyDir)
        val (_, sA) = tab.pair("papa", Role.ADMIN)
        val wifi = TcpRelay(tab.port, "wifi")
        val lte = TcpRelay(tab.port, "lte")
        val a = Phone("papa", sA, tab.fp, cands = { listOf(tab.via(wifi, "lan", 0), tab.via(lte, "ipv6", 1)) }).start()
        a.awaitActive("lan")
        wifi.mode = TcpRelay.Mode.BLACKHOLE                           // Wi-Fi perdu en sortant de la maison
        val t0 = System.currentTimeMillis()
        a.client.onNetworkChanged("Wi-Fi perdu")
        a.awaitActive("ipv6", 5_000)
        val dt = System.currentTimeMillis() - t0
        T.check(dt < 2_500) { "bascule trop lente : $dt ms" }
        println("      (bascule en $dt ms)")
        a.client.stop(); tab.server.stop(); wifi.close(); lte.close()
    }

    println("\nPersistance")
    T.test("redémarrage du téléphone : lastSeq, session et file d'attente conservés") {
        val tab = Tablet(keyDir)
        val (_, sA) = tab.pair("papa", Role.ADMIN)
        val dir = scratch("phone-a")
        val path = TcpRelay(tab.port, "p")
        var store = FileClientStore(dir)
        var a = Phone("papa", sA, tab.fp, store, cands = { listOf(tab.via(path, "lan", 0)) }).start()
        a.awaitActive()
        repeat(3) { tab.server.submitLocal("chat.private", "m$it".toByteArray()) }
        T.await("3 reçus") { a.rec.events.size == 3 }
        path.mode = TcpRelay.Mode.DOWN
        T.await("hors ligne") { a.client.state != SessionState.ONLINE }
        a.client.submit("chat.private", "écrit hors ligne".toByteArray())
        val sid = store.sessionId
        a.client.stop(); store.close()
        tab.server.submitLocal("chat.private", "pendant l'arrêt".toByteArray())

        store = FileClientStore(dir)                                  // relance de l'application
        T.check(store.lastSeq == 3L && store.sessionId == sid && store.outbox().size == 1) {
            "rechargé : lastSeq=${store.lastSeq} outbox=${store.outbox().size}"
        }
        path.mode = TcpRelay.Mode.FORWARD
        a = Phone("papa", sA, tab.fp, store, cands = { listOf(tab.via(path, "lan", 0)) }).start()
        a.awaitActive()
        T.await("delta reçu et outbox vidée") { store.lastSeq == 5L && store.outbox().isEmpty() }
        T.check(a.rec.events.map { it.seq } == listOf(4L, 5L)) { "seuls les manquants : ${a.rec.events.map { it.seq }}" }
        a.client.stop(); store.close(); tab.server.stop(); path.close()
    }

    T.test("redémarrage de la tablette : journal, appareils et sessions rechargés, reconnexion auto") {
        val tdir = scratch("tablet")
        val srvStore1 = FileServerStore(tdir)
        var tab = Tablet(keyDir, srvStore1)
        val (_, sA) = tab.pair("papa", Role.ADMIN)
        val path = TcpRelay(tab.port, "p")
        val a = Phone("papa", sA, tab.fp, cands = { listOf(tab.via(path, "lan", 0)) }).start()
        a.awaitActive()
        a.client.submit("chat.group", "avant reboot".toByteArray())
        T.await("acquitté") { a.store.outbox().isEmpty() }
        val sid = a.store.sessionId
        tab.server.stop(); srvStore1.close()                         // coupure de courant de la tablette
        T.await("papa détecte") { a.client.state != SessionState.ONLINE }
        a.client.submit("chat.group", "pendant reboot".toByteArray())

        val srvStore2 = FileServerStore(tdir)
        tab = Tablet(keyDir, srvStore2)
        path.targetPort = tab.port
        T.check(srvStore2.headSeq() == 1L && srvStore2.device("papa") != null) { "rechargement serveur" }
        a.awaitActive()
        T.await("outbox livrée") { a.store.outbox().isEmpty() && srvStore2.headSeq() == 2L }
        T.check(a.store.sessionId == sid) { "session non reprise après reboot" }
        a.client.stop(); tab.server.stop(); srvStore2.close(); path.close()
    }

    T.test("journal tronqué (coupure pendant l'écriture) : récupération automatique") {
        val dir = scratch("torn")
        val s1 = FileClientStore(dir)
        s1.applyEvent(Event(1, "a", "x", "chat.group", "un".toByteArray(), 1))
        s1.applyEvent(Event(2, "b", "x", "chat.group", "deux".toByteArray(), 2))
        s1.close()
        File(dir, "events.log").appendBytes(byteArrayOf(0, 0, 0, 50, 1, 2, 3))    // écriture interrompue
        val s2 = FileClientStore(dir)
        T.check(s2.lastSeq == 2L && s2.events().size == 2) { "lastSeq=${s2.lastSeq}" }
        s2.applyEvent(Event(3, "c", "x", "chat.group", "trois".toByteArray(), 3))
        s2.close()
        T.check(FileClientStore(dir).lastSeq == 3L) { "journal inutilisable après réparation" }
    }

    T.test("export XML lisible et échappé") {
        val xml = XmlExport.events(listOf(Event(1, "i", "papa", "chat.group", "a < b & \"c\"".toByteArray(), 0)), "Famille")
        T.check(xml.contains("a &lt; b &amp; &quot;c&quot;") && xml.contains("seq=\"1\"")) { xml }
    }

    println("\nSécurité")
    T.test("appareil révoqué : session coupée, erreur fatale, pas de reconnexion") {
        val tab = Tablet(keyDir)
        val (_, sA) = tab.pair("papa", Role.ADMIN)
        val a = Phone("papa", sA, tab.fp, cands = { listOf(tab.direct()) }).start()
        a.awaitActive()
        tab.server.revoke("papa")
        T.await("fatal reçu") { a.rec.fatal == ErrorCode.UNKNOWN_DEVICE }
        T.check(a.client.state == SessionState.CLOSED) { "état ${a.client.state}" }
        tab.server.stop()
    }
    T.test("usurpation : bonne identité, mauvaise clé → signature refusée") {
        val tab = Tablet(keyDir)
        tab.pair("papa", Role.ADMIN)
        val thief = Phone("papa", SoftwareSigner.generate(), tab.fp, cands = { listOf(tab.direct()) }).start()
        T.await("fatal BAD_SIGNATURE") { thief.rec.fatal == ErrorCode.BAD_SIGNATURE }
        T.check(tab.server.activeSessions().isEmpty()) { "session ouverte !" }
        tab.server.stop()
    }
    T.test("politique de rôles : un parent ne peut pas gérer les membres") {
        val tab = Tablet(keyDir)
        val (_, sB) = tab.pair("maman", Role.PARENT)
        val b = Phone("maman", sB, tab.fp, cands = { listOf(tab.direct()) }).start()
        b.awaitActive()
        val id = b.client.submit("member.add", "intrus".toByteArray())
        T.await("rejeté") { b.rec.rejected.contains(id) }
        T.check(b.store.outbox().isEmpty() && tab.store.headSeq() == 0L) { "action interdite enregistrée" }
        T.check(tab.server.submitLocal("config.set", "x".toByteArray()) == null) { "l'enfant a modifié la config" }
        b.client.stop(); tab.server.stop()
    }
    T.test("idempotence : un Submit rejoué ne crée pas de doublon") {
        val tab = Tablet(keyDir)
        val (_, sA) = tab.pair("papa", Role.ADMIN)
        val t = tab.direct().connect(3_000)
        t.send(Msg.Hello("papa", PROTO_VERSION, null, 0))
        val ch = t.receive() as Msg.Challenge
        t.send(Msg.Auth(sA.sign(Crypto.authTranscript(ch.nonce, "papa", tab.fp))))
        T.check(t.receive() is Msg.AuthOk && t.receive() is Msg.SyncDone) { "handshake" }
        val acks = ArrayList<Long>()
        repeat(3) {
            t.send(Msg.Submit("même-id", "chat.group", "x".toByteArray()))
            while (true) { val m = t.receive(); if (m is Msg.SubmitAck) { acks += m.seq; break } }
        }
        T.check(acks == listOf(1L, 1L, 1L) && tab.store.headSeq() == 1L) { "acks=$acks" }
        t.close(); tab.server.stop()
    }

    println("\nÉtat de la tablette")
    T.test("enfant ferme l'application : le parent reçoit « application non démarrée », même hors ligne") {
        val tab = Tablet(keyDir)
        val (_, sA) = tab.pair("papa", Role.ADMIN)
        val path = TcpRelay(tab.port, "4g")
        val a = Phone("papa", sA, tab.fp, cands = { listOf(tab.via(path, "ipv6", 1)) }).start()
        a.awaitActive()
        tab.server.publishStatus(TabletStatus.APP_CLOSED)                // en direct
        T.await("statut reçu en direct") { a.rec.texts().contains(TabletStatus.APP_CLOSED) }
        path.mode = TcpRelay.Mode.DOWN                                   // le parent est hors réseau…
        T.await("hors ligne") { a.client.state != SessionState.ONLINE }
        tab.server.publishStatus(TabletStatus.APP_OPEN)
        tab.server.publishStatus(TabletStatus.APP_CLOSED)                // …pendant que l'enfant rouvre puis ferme
        path.mode = TcpRelay.Mode.FORWARD
        a.awaitActive()
        T.await("statuts rattrapés") { a.rec.events.count { it.kind == TabletStatus.KIND } == 3 }
        T.check(a.rec.events.last().text == TabletStatus.APP_CLOSED) { "dernier statut : ${a.rec.events.last().text}" }
        T.check(tab.server.submitLocal(TabletStatus.KIND, "faux".toByteArray()) == null) { "l'enfant peut forger un statut" }
        a.client.stop(); tab.server.stop(); path.close()
    }

    println("\nCarnet d'extrémités")
    T.test("mise à jour en bande des extrémités (changement de préfixe IPv6)") {
        val tab = Tablet(keyDir)
        val (rec, sA) = tab.pair("papa", Role.ADMIN)
        val book = EndpointBook(rec.fingerprint, listOf("ip:[2001:db8:1::10]:8443", "ip:127.0.0.1:${tab.port}"))
        val a = Phone("papa", sA, tab.fp, cands = { book.candidates() }, book = book).start()
        a.awaitActive("ipv4")
        tab.server.publishEndpoints(listOf("lan", "ip:[2001:db8:2::10]:8443", "onion:abcdefghij.onion:8443"))
        T.await("carnet mis à jour") { book.all().contains("ip:[2001:db8:2::10]:8443") }
        T.check(EndpointBook.splitHostPort("[2001:db8::1]:8443") == ("2001:db8::1" to 8443)) { "parse v6" }
        a.client.stop(); tab.server.stop()
    }

    println("\n${T.passed} réussi(s), ${T.failed.size} échec(s)")
    if (T.failed.isNotEmpty()) { println("Échecs : ${T.failed}"); exitProcess(1) }
    exitProcess(0)
}
