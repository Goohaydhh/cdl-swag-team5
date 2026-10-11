package fr.ecl.famchat.session.server

import fr.ecl.famchat.session.crypto.Crypto
import fr.ecl.famchat.session.wire.Role
import java.net.Inet6Address
import java.net.InetAddress
import java.net.URLDecoder
import java.net.URLEncoder

/**
 * Invitation d'appairage affichée en QR code par la tablette.
 * Contenu : jeton à usage unique + empreinte du certificat TLS + extrémités joignables.
 * Aucun e-mail, aucun compte : l'identité du téléphone sera sa clé publique.
 */
class PairingInvite(
    val token: String,
    val role: Role,
    val expiresAt: Long,
    val fingerprint: ByteArray,
    val endpoints: List<String>,
    val familyName: String,
) {
    fun toUri(): String = buildString {
        append("famchat://pair?v=1")
        append("&t=").append(token)
        append("&r=").append(role.name)
        append("&x=").append(expiresAt)
        append("&fp=").append(Crypto.toHex(fingerprint))
        append("&f=").append(enc(familyName))
        for (e in endpoints) append("&e=").append(enc(e))
    }

    companion object {
        private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")
        private fun dec(s: String) = URLDecoder.decode(s, "UTF-8")

        fun parse(uri: String): PairingInvite {
            require(uri.startsWith("famchat://pair?")) { "QR code non reconnu" }
            val params = uri.substringAfter('?').split('&').map { it.substringBefore('=') to dec(it.substringAfter('=')) }
            fun one(k: String) = params.firstOrNull { it.first == k }?.second ?: error("paramètre $k manquant")
            require(one("v") == "1") { "version d'invitation non supportée" }
            return PairingInvite(
                token = one("t"), role = Role.valueOf(one("r")), expiresAt = one("x").toLong(),
                fingerprint = Crypto.fromHex(one("fp")), endpoints = params.filter { it.first == "e" }.map { it.second },
                familyName = one("f"),
            )
        }
    }
}

object NetPolicy {
    /**
     * Vrai si l'adresse du pair est « locale » : boucle, RFC 1918, lien-local, IPv6 ULA (fc00::/7).
     * L'appairage n'est accepté que depuis ces adresses (co-présence à la maison).
     *
     * NB : 100.64.0.0/10 (RFC 6598, espace partagé CGNAT) n'est volontairement PAS considéré
     * comme local : c'est un adressage opérateur, situé hors du domicile.
     */
    fun isLocal(a: InetAddress): Boolean {
        if (a.isLoopbackAddress || a.isLinkLocalAddress || a.isSiteLocalAddress) return true
        if (a is Inet6Address) {
            val b0 = a.address[0].toInt() and 0xFF
            if (b0 and 0xFE == 0xFC) return true                    // ULA fc00::/7
            if (a.isIPv4CompatibleAddress) return false
        }
        return false
    }

    /** Classification utile au diagnostic réseau de l'écran parent. */
    fun classifyV4(a: InetAddress): String {
        val b = a.address.map { it.toInt() and 0xFF }
        if (b.size != 4) return "IPV6"
        return when {
            b[0] == 10 || (b[0] == 172 && b[1] in 16..31) || (b[0] == 192 && b[1] == 168) -> "PRIVATE_RFC1918"
            b[0] == 100 && b[1] in 64..127 -> "SHARED_RFC6598_CGNAT"
            b[0] == 169 && b[1] == 254 -> "LINK_LOCAL"
            b[0] == 127 -> "LOOPBACK"
            else -> "PUBLIC"
        }
    }
}

/** Politique de rôles : quels types d'événements chaque rôle peut émettre. */
object RolePolicy {
    fun allowed(role: Role, kind: String): Boolean = when (role) {
        Role.SYSTEM, Role.ADMIN -> true
        Role.PARENT -> !kind.startsWith("member.") && !kind.startsWith("sys.")
        Role.CHILD -> kind.startsWith("chat.") || kind == "forum.post" || kind == "mustdo.done"
    }
}
