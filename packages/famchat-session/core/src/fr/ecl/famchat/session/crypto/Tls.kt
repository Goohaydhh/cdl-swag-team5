package fr.ecl.famchat.session.crypto

import java.security.KeyStore
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocket
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

/**
 * Vérification du certificat de la tablette par ÉPINGLAGE : on n'utilise ni autorité de
 * certification ni nom d'hôte. Seule compte l'empreinte SHA-256 du certificat feuille,
 * transmise une fois dans le QR code d'appairage (canal hors bande, co-présence physique).
 *
 * Conséquence utile : la même vérification vaut quel que soit le chemin
 * (IP du LAN, IPv6 globale, adresse .onion) — l'identité ne dépend pas de l'adresse.
 */
class PinnedTrustManager(private val pinnedSha256: ByteArray) : X509TrustManager {
    override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
        if (chain.isNullOrEmpty()) throw CertificateException("chaîne vide")
        val fp = Crypto.sha256(chain[0].encoded)
        if (!Crypto.constantTimeEquals(fp, pinnedSha256)) {
            throw CertificateException("empreinte du certificat inattendue : ${Crypto.toHex(fp)}")
        }
    }
    override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) =
        throw CertificateException("non utilisé")
    override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
}

object Tls {
    /** TLS 1.3 uniquement (Android 10 / API 29 minimum). */
    val PROTOCOLS = arrayOf("TLSv1.3")

    fun clientContext(pinnedSha256: ByteArray): SSLContext =
        SSLContext.getInstance("TLS").apply {
            init(null, arrayOf<TrustManager>(PinnedTrustManager(pinnedSha256)), null)
        }

    /** Contexte serveur à partir d'un KeyStore contenant la clé et le certificat auto-signé. */
    fun serverContext(ks: KeyStore, keyPassword: CharArray?): SSLContext {
        val kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm())
        kmf.init(ks, keyPassword)
        return SSLContext.getInstance("TLS").apply { init(kmf.keyManagers, null, null) }
    }

    fun fingerprint(ks: KeyStore, alias: String): ByteArray {
        val cert = ks.getCertificate(alias) ?: error("alias $alias absent du keystore")
        return Crypto.sha256(cert.encoded)
    }

    fun harden(s: SSLSocket) {
        s.enabledProtocols = PROTOCOLS
    }
}
