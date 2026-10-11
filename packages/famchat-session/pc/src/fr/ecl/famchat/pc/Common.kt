package fr.ecl.famchat.pc

import fr.ecl.famchat.session.Log
import fr.ecl.famchat.session.transport.EndpointBook
import java.io.File
import java.io.FileInputStream
import java.net.Inet4Address
import java.net.Inet6Address
import java.net.NetworkInterface
import java.security.KeyStore

/** Journal console : seulement les lignes utiles au test (pas le détail des chemins). */
class ConsoleLog(private val who: String) : Log {
    override fun d(tag: String, msg: String) {
        if (tag == "path" && msg.startsWith("échec")) return
        if (msg.startsWith("→")) return                      // les états sont déjà affichés en clair
        println("  ($who) $msg")
    }
}

/** Certificat auto-signé de la « tablette » PC, généré une fois avec keytool (fourni par le JDK). */
fun loadOrCreateKeystore(f: File, pass: CharArray): KeyStore {
    if (!f.exists()) {
        f.parentFile.mkdirs()
        val exe = if (System.getProperty("os.name").lowercase().contains("win")) "keytool.exe" else "keytool"
        val keytool = File(File(System.getProperty("java.home"), "bin"), exe).path
        val p = ProcessBuilder(
            keytool, "-genkeypair", "-alias", "famchat", "-keyalg", "EC", "-groupname", "secp256r1",
            "-sigalg", "SHA256withECDSA", "-dname", "CN=famchat-tablet", "-validity", "3650",
            "-storetype", "PKCS12", "-keystore", f.path, "-storepass", String(pass), "-keypass", String(pass),
        ).redirectErrorStream(true).start()
        val out = p.inputStream.readBytes().decodeToString()
        check(p.waitFor() == 0) { "keytool a échoué : $out" }
    }
    return KeyStore.getInstance("PKCS12").apply { FileInputStream(f).use { load(it, pass) } }
}

/** Adresses du PC utilisables par le téléphone : IPv4 privée (Wi-Fi) et IPv6 globales. */
fun localEndpoints(port: Int): List<String> {
    val out = ArrayList<String>()
    for (ni in NetworkInterface.getNetworkInterfaces()) {
        if (!ni.isUp || ni.isLoopback || ni.isVirtual) continue
        val name = (ni.displayName ?: ni.name).lowercase()
        if (listOf("virtual", "vmware", "vbox", "hyper-v", "wsl", "docker", "vethernet").any { it in name }) continue
        for (a in ni.inetAddresses) {
            when {
                a is Inet4Address && a.isSiteLocalAddress -> out += EndpointBook.formatIp(a.hostAddress, port)
                a is Inet6Address && !a.isLinkLocalAddress && !a.isSiteLocalAddress &&
                    (a.address[0].toInt() and 0xFE) != 0xFC ->
                    out += EndpointBook.formatIp(a.hostAddress.substringBefore('%'), port)
            }
        }
    }
    out += EndpointBook.formatIp("127.0.0.1", port)          // téléphone simulé sur le même PC
    return out.distinct()
}
