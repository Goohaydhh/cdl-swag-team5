package fr.ecl.famchat.pc

import fr.ecl.famchat.session.crypto.Crypto
import fr.ecl.famchat.session.crypto.Tls
import fr.ecl.famchat.session.server.ServerConfig
import fr.ecl.famchat.session.server.SessionServer
import fr.ecl.famchat.session.server.TabletStatus
import fr.ecl.famchat.session.store.FileServerStore
import fr.ecl.famchat.session.store.XmlExport
import fr.ecl.famchat.session.wire.Role
import java.io.File
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * Le PC joue la TABLETTE : même serveur de session que sur Android, piloté au clavier.
 *   tablette.bat   (ou : java -cp famchat-pc.jar fr.ecl.famchat.pc.PcTabletKt [dossier] [port])
 */
fun main(args: Array<String>) {
    val dir = File(args.getOrNull(0) ?: "famchat-tablette")
    val port = args.getOrNull(1)?.toInt() ?: 8443
    val pass = "famchat".toCharArray()
    val ks = loadOrCreateKeystore(File(dir, "tablette.p12"), pass)
    val fp = Tls.fingerprint(ks, "famchat")
    val store = FileServerStore(File(dir, "serveur"))
    val server = SessionServer(ServerConfig(port = port, familyName = "Famille test"),
        Tls.serverContext(ks, pass), fp, store, ConsoleLog("tablette"))
    val hhmm = DateTimeFormatter.ofPattern("HH:mm:ss").withZone(ZoneId.systemDefault())
    server.addListener { e -> println("[#${e.seq} ${hhmm.format(Instant.ofEpochMilli(e.ts))}] ${e.origin} · ${e.kind} : ${e.text}") }
    server.start()

    println("""
        |
        |=== FamChat : le PC joue la TABLETTE (port $port) ===
        |Empreinte du certificat : ${Crypto.toHex(fp).take(16)}…
        |Adresses vues par le téléphone : ${localEndpoints(port).ifEmpty { listOf("aucune !") }.joinToString("  ")}
        |
        |Commandes :
        |  invite            nouvelle invitation d'appairage (rôle ADMIN)   invite parent : rôle PARENT
        |  msg <texte>       l'enfant écrit un message
        |  fait <tâche>      l'enfant coche une tâche MustDo
        |  ferme / ouvre     simule la fermeture / réouverture de l'application par l'enfant
        |  sessions          téléphones connectés et leur chemin
        |  appareils         téléphones appairés      revoque <id>   révoque un téléphone
        |  export            journal en XML           quitter
        |""".trimMargin())

    while (true) {
        print("tablette> ")
        val line = readlnOrNull()?.trim() ?: break
        val cmd = line.substringBefore(' ')
        val arg = line.substringAfter(' ', "").trim()
        when (cmd) {
            "invite" -> {
                val role = if (arg == "parent") Role.PARENT else Role.ADMIN
                val inv = server.createPairingInvite(role, localEndpoints(port), ttlMs = 10 * 60_000)
                val uri = inv.toUri()
                File(dir, "invitation.txt").writeText(uri)
                println("\nInvitation ($role, valable 10 min, usage unique) :\n$uri\n")
                println("→ téléphone Android branché en USB :")
                println("  adb shell \"am start -a android.intent.action.VIEW -d '$uri'\"")
                println("→ ou un QR code :  py -m pip install qrcode[pil]   puis   py -m qrcode \"$uri\" > invitation.png")
                println("→ ou téléphone simulé sur un PC :  telephone-pc.bat \"$uri\"\n")
            }
            "msg" -> server.submitLocal("chat.group", arg.toByteArray())
            "fait" -> server.submitLocal("mustdo.done", arg.toByteArray())
            "ferme" -> server.publishStatus(TabletStatus.APP_CLOSED)
            "ouvre" -> server.publishStatus(TabletStatus.APP_OPEN)
            "sessions" -> {
                val l = server.activeSessions()
                if (l.isEmpty()) println("aucun téléphone connecté")
                l.forEach { println(" - ${it.deviceId} (${it.role}) via ${it.remote}") }
            }
            "appareils" -> store.devices().forEach {
                println(" - ${it.id}  ${it.name}  ${it.role}${if (it.revoked) "  (RÉVOQUÉ)" else ""}")
            }
            "revoque" -> { server.revoke(arg); println("révoqué : $arg") }
            "export" -> File(dir, "journal.xml").also { it.writeText(XmlExport.events(store.eventsAfter(0), "Famille test")); println("écrit : ${it.absolutePath}") }
            "quitter", "exit", "quit" -> break
            "" -> {}
            else -> println("commande inconnue : $cmd")
        }
    }
    server.publishStatus(TabletStatus.SERVER_STOPPED)
    Thread.sleep(300)
    server.stop(); store.close()
}
