package fr.ecl.famchat.session.transport

import fr.ecl.famchat.session.Log
import fr.ecl.famchat.session.NoLog
import fr.ecl.famchat.session.crypto.Tls
import java.io.IOException
import java.net.InetSocketAddress
import java.net.Proxy

/**
 * Sélection de chemin : on essaie les chemins par ordre de priorité (LAN, IPv6, IPv4, Tor)
 * et on garde le premier qui établit TCP + TLS épinglé. Simple et déterministe ; le coût
 * d'un chemin mort est borné par le délai de connexion.
 */
object Paths {
    fun firstReachable(candidates: List<PathCandidate>, timeoutMs: Int, log: Log = NoLog): Transport? {
        for (c in candidates.sortedBy { it.priority }) {
            try {
                return c.connect(timeoutMs).also { log.d("path", "chemin ${c.name} établi vers ${it.remote}") }
            } catch (e: Exception) {
                log.d("path", "échec ${c.name} : ${e.message}")
            }
        }
        return null
    }

    /**
     * Pour l'appairage : le LAN et l'IPv4 privée d'abord, car la tablette n'accepte l'appairage
     * que depuis une adresse locale (une IPv6 globale serait refusée).
     */
    fun forPairing(c: List<PathCandidate>) =
        c.map { PathCandidate(it.name, if (it.name == "lan" || it.name == "ipv4") 0 else 10 + it.priority, it.connect) }
}

/**
 * Carnet des extrémités connues de la tablette (issu du QR d'appairage, puis mis à jour
 * en bande par l'événement "sys.endpoints" quand le préfixe IPv6 change).
 *
 * Formats :  "lan"                         découverte DNS-SD sur le Wi-Fi courant
 *            "ip:[2a01:db8::1]:8443"       IPv6 globale
 *            "ip:203.0.113.7:8443"         IPv4 (redirection de port, hors CGNAT)
 *            "host:maison.example:8443"    nom DNS
 *            "onion:xxxx.onion:8443"       service onion Tor
 */
class EndpointBook(
    private val pinnedSha256: ByteArray,
    initial: List<String>,
    /** Résolution NSD courante (null si la tablette n'est pas vue sur le LAN). */
    private val lanResolver: (() -> InetSocketAddress?)? = null,
    /** Port SOCKS du démon Tor embarqué (null si Tor n'est pas démarré). */
    private val torSocks: InetSocketAddress? = null,
) {
    @Volatile private var endpoints: List<String> = initial.toList()
    private val ctx = Tls.clientContext(pinnedSha256)

    fun all(): List<String> = endpoints
    fun update(newEndpoints: List<String>) { endpoints = newEndpoints.toList() }

    fun candidates(): List<PathCandidate> {
        val out = ArrayList<PathCandidate>()
        for (ep in endpoints) {
            val kind = ep.substringBefore(':')
            val rest = ep.substringAfter(':', "")
            when (kind) {
                "lan" -> {
                    val resolver = lanResolver ?: continue
                    val addr = resolver() ?: continue          // tablette non visible : on ne tente pas
                    val host = addr.address?.hostAddress ?: addr.hostString
                    out += PathCandidate("lan", 0, Connectors.tls("lan", host, addr.port, ctx))
                }
                "ip" -> {
                    val (host, port) = splitHostPort(rest)
                    val v6 = host.contains(':')
                    val name = if (v6) "ipv6" else "ipv4"
                    out += PathCandidate(name, if (v6) 1 else 2, Connectors.tls(name, host, port, ctx))
                }
                "host" -> {
                    val (host, port) = splitHostPort(rest)
                    out += PathCandidate("dns", 2, Connectors.tls("dns", host, port, ctx))
                }
                "onion" -> {
                    val socks = torSocks ?: continue
                    val (host, port) = splitHostPort(rest)
                    out += PathCandidate("tor", 3,
                        Connectors.tls("tor", host, port, ctx, Proxy(Proxy.Type.SOCKS, socks)))
                }
            }
        }
        return out
    }

    companion object {
        fun splitHostPort(s: String): Pair<String, Int> {
            if (s.startsWith("[")) {
                val end = s.indexOf(']')
                if (end < 0) throw IOException("extrémité invalide : $s")
                return s.substring(1, end) to s.substring(end + 2).toInt()
            }
            val i = s.lastIndexOf(':')
            if (i < 0) throw IOException("port manquant : $s")
            return s.substring(0, i) to s.substring(i + 1).toInt()
        }

        fun formatIp(host: String, port: Int) = if (host.contains(':')) "ip:[$host]:$port" else "ip:$host:$port"
    }
}
