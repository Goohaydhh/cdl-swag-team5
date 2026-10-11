package fr.ecl.famchat.android

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import fr.ecl.famchat.session.Log
import fr.ecl.famchat.session.crypto.DeviceSigner
import fr.ecl.famchat.session.crypto.Tls
import java.math.BigInteger
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.util.Date
import javax.net.ssl.SSLContext
import javax.security.auth.x500.X500Principal

/** Journal du module branché sur Logcat. */
object AndroidLog : Log {
    override fun d(tag: String, msg: String) { android.util.Log.d("FamChat/$tag", msg) }
}

private fun androidKeyStore() = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

/**
 * TÉLÉPHONE : identité de l'appareil = paire de clés EC P-256 générée DANS l'Android Keystore
 * (matériel sécurisé / StrongBox si disponible). La clé privée n'est jamais exportable :
 * même un vol des fichiers de l'application ne permet pas d'usurper le téléphone.
 */
class KeystoreDeviceSigner(private val alias: String = "famchat-device") : DeviceSigner {
    private val ks = androidKeyStore()

    init {
        if (!ks.containsAlias(alias)) {
            val g = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
            g.initialize(
                KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN)
                    .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
                    .setDigests(KeyProperties.DIGEST_SHA256)
                    // Pas d'authentification utilisateur exigée : la session doit pouvoir se
                    // rétablir en arrière-plan (téléphone en poche).
                    .setUserAuthenticationRequired(false)
                    .build()
            )
            g.generateKeyPair()
        }
    }

    override val publicKeyEncoded: ByteArray get() = ks.getCertificate(alias).publicKey.encoded

    override fun sign(data: ByteArray): ByteArray {
        val pk = ks.getKey(alias, null) as PrivateKey
        return Signature.getInstance("SHA256withECDSA").run { initSign(pk); update(data); sign() }
    }

    /** Désappairage local : détruit la clé (il faudra réappairer). */
    fun destroy() = ks.deleteEntry(alias)
}

/**
 * TABLETTE : clé TLS + certificat auto-signé, générés dans l'Android Keystore.
 * Le Keystore produit lui-même le certificat X.509 auto-signé : pas besoin de BouncyCastle.
 * L'empreinte SHA-256 de ce certificat est ce qui part dans le QR code (épinglage).
 */
class TabletTlsIdentity(private val alias: String = "famchat-tls") {
    private val ks = androidKeyStore()

    init {
        if (!ks.containsAlias(alias)) {
            val g = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
            g.initialize(
                KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN)
                    .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
                    // DIGEST_NONE est utilisé par la pile TLS (Conscrypt) pour certaines signatures.
                    .setDigests(KeyProperties.DIGEST_NONE, KeyProperties.DIGEST_SHA256,
                                KeyProperties.DIGEST_SHA384, KeyProperties.DIGEST_SHA512)
                    .setCertificateSubject(X500Principal("CN=famchat-tablet"))
                    .setCertificateSerialNumber(BigInteger.ONE)
                    .setCertificateNotBefore(Date())
                    .setCertificateNotAfter(Date(System.currentTimeMillis() + 20L * 365 * 24 * 3600 * 1000))
                    .build()
            )
            g.generateKeyPair()
        }
    }

    val fingerprint: ByteArray get() = Tls.fingerprint(ks, alias)

    /** Contexte TLS serveur : la clé privée reste dans le Keystore, Conscrypt signe via celui-ci. */
    fun serverContext(): SSLContext = Tls.serverContext(ks, null)

    /** Rotation volontaire (compromission suspectée) : tous les téléphones devront réappairer. */
    fun rotate() = ks.deleteEntry(alias)
}
