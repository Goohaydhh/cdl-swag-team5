package fr.ecl.famchat.pc

import fr.ecl.famchat.session.client.ClientConfig
import fr.ecl.famchat.session.client.PairingClient
import fr.ecl.famchat.session.client.SessionClient
import fr.ecl.famchat.session.client.SessionListener
import fr.ecl.famchat.session.client.SessionState
import fr.ecl.famchat.session.crypto.Crypto
import fr.ecl.famchat.session.crypto.SoftwareSigner
import fr.ecl.famchat.session.server.PairingInvite
import fr.ecl.famchat.session.server.TabletStatus
import fr.ecl.famchat.session.store.FileClientStore
import fr.ecl.famchat.session.transport.EndpointBook
import fr.ecl.famchat.session.transport.Paths
import fr.ecl.famchat.session.wire.Event
import java.io.File
import java.security.KeyFactory
import java.security.KeyPair
import java.security.spec.PKCS8EncodedKeySpec
import java.security.spec.X509EncodedKeySpec
import java.util.Base64
import java.util.Properties
import java.util.UUID
import kotlin.system.exitProcess

/**
 * Le PC joue le TÉLÉPHONE du parent (pour valider le protocole avant de passer sur Android).
 *   1re fois : java -cp famchat-pc.jar fr.ecl.famchat.pc.PcPhoneKt "famchat://pair?..." [dossier]
 *   ensuite  : java -cp famchat-pc.jar fr.ecl.famchat.pc.PcPhoneKt [dossier]
 */
fun main(args: Array<String>) {
    val invite = args.firstOrNull { it.startsWith("famchat://") }
    val dir = File(args.firstOrNull { !it.startsWith("famchat://") } ?: "famchat-telephone")
    val propsFile = File(dir, "appairage.properties")
    val p = Properties()
    val b64 = Base64.getEncoder(); val unb64 = Base64.getDecoder()

    if (invite != null) {
        // --- Appairage (une seule fois) ---
        val inv = PairingInvite.parse(invite)
        val kp = java.security.KeyPairGenerator.getInstance("EC").apply {
            initialize(java.security.spec.ECGenParameterSpec("secp256r1"))
        }.generateKeyPair()
        val deviceId = "pc-" + UUID.randomUUID().toString().take(8)
        val link = Paths.firstReachable(Paths.forPairing(EndpointBook(inv.fingerprint, inv.endpoints).candidates()), 5_000, ConsoleLog("téléphone"))
            ?: run { println("Tablette injoignable : même réseau ? pare-feu Windows ?"); exitProcess(1) }
        val rec = PairingClient.pair(inv, link, deviceId, SoftwareSigner(kp), "Téléphone PC")
        dir.mkdirs()
        p["deviceId"] = rec.deviceId; p["fp"] = Crypto.toHex(rec.fingerprint); p["role"] = rec.role.name
        p["endpoints"] = rec.endpoints.joinToString("|")
        p["pub"] = b64.encodeToString(kp.public.encoded); p["priv"] = b64.encodeToString(kp.private.encoded)
        propsFile.outputStream().use { p.store(it, "FamChat - appairage du telephone PC (cle privee : a ne pas partager)") }
        println("Appairé : ${rec.deviceId} (${rec.role}) dans la famille « ${rec.familyName} »")
    }

    if (!propsFile.exists()) { println("Pas encore appairé : passez l'invitation en argument."); exitProcess(1) }
    propsFile.inputStream().use { p.load(it) }
    val kf = KeyFactory.getInstance("EC")
    val signer = SoftwareSigner(KeyPair(
        kf.generatePublic(X509EncodedKeySpec(unb64.decode(p.getProperty("pub")))),
        kf.generatePrivate(PKCS8EncodedKeySpec(unb64.decode(p.getProperty("priv"))))))
    val fp = Crypto.fromHex(p.getProperty("fp"))
    val book = EndpointBook(fp, p.getProperty("endpoints").split('|').filter { it.isNotBlank() })
    val store = FileClientStore(File(dir, "session"))

    val ui = object : SessionListener {
        override fun onState(state: SessionState, path: String?) {
            println(when (state) {
                SessionState.ONLINE -> "● EN LIGNE via ${path ?: "?"}"
                SessionState.OFFLINE -> "○ HORS LIGNE — ${TabletStatus.UNREACHABLE}"
                SessionState.CONNECTING -> "… connexion"
                SessionState.CLOSED -> "■ session fermée"
            })
        }
        override fun onEvent(e: Event) {
            val who = if (e.origin == p.getProperty("deviceId")) "moi" else e.origin
            println(if (e.kind == TabletStatus.KIND) "⚠ TABLETTE : ${e.text}" else "[#${e.seq}] $who · ${e.kind} : ${e.text}")
        }
        override fun onSubmitted(clientMsgId: String, seq: Long) = println("  ✓ reçu par la tablette (#$seq)")
        override fun onRejected(clientMsgId: String, reason: String) = println("  ✗ refusé : $reason")
        override fun onFatal(code: Int, reason: String) = println("■ ERREUR FATALE ($code) : $reason — réappairage nécessaire")
    }

    val client = SessionClient(ClientConfig(p.getProperty("deviceId"), signer, fp), store, book::candidates, ui, ConsoleLog("téléphone"), book)
    println("\n=== FamChat : le PC joue le TÉLÉPHONE (${p.getProperty("deviceId")}) ===")
    println("Tapez un message puis Entrée.  /reseau = simuler un changement de réseau   /quitter\n")
    client.start()
    while (true) {
        val line = readlnOrNull()?.trim() ?: break
        when {
            line == "/quitter" -> break
            line == "/reseau" -> client.onNetworkChanged("simulé au clavier")
            line.isNotEmpty() -> client.submit("chat.group", line.toByteArray())
        }
    }
    client.stop(); Thread.sleep(300); store.close()
}
