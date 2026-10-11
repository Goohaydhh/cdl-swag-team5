package fr.ecl.famchat.session.crypto

import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.security.KeyFactory
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.security.spec.X509EncodedKeySpec

/**
 * Identité cryptographique d'un appareil (téléphone parent).
 * Sur Android : implémentation adossée à l'Android Keystore (clé non exportable),
 * voir android/KeystoreDeviceSigner.kt. Ici : implémentation logicielle pour les tests JVM.
 */
interface DeviceSigner {
    /** Clé publique encodée X.509 SubjectPublicKeyInfo (EC P-256). */
    val publicKeyEncoded: ByteArray
    fun sign(data: ByteArray): ByteArray
}

class SoftwareSigner(private val kp: KeyPair) : DeviceSigner {
    override val publicKeyEncoded: ByteArray = kp.public.encoded
    override fun sign(data: ByteArray): ByteArray =
        Signature.getInstance("SHA256withECDSA").run { initSign(kp.private); update(data); sign() }

    companion object {
        fun generate(): SoftwareSigner {
            val g = KeyPairGenerator.getInstance("EC")
            g.initialize(ECGenParameterSpec("secp256r1"))
            return SoftwareSigner(g.generateKeyPair())
        }
    }
}

object Crypto {
    private val rng = SecureRandom()

    fun random(n: Int) = ByteArray(n).also { rng.nextBytes(it) }
    fun randomToken(nBytes: Int = 16): String = toHex(random(nBytes))

    fun sha256(b: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(b)

    fun verify(publicKeyEncoded: ByteArray, data: ByteArray, sig: ByteArray): Boolean = try {
        val pk = KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(publicKeyEncoded))
        Signature.getInstance("SHA256withECDSA").run { initVerify(pk); update(data); verify(sig) }
    } catch (e: Exception) {
        false
    }

    fun isValidEcPublicKey(encoded: ByteArray): Boolean = try {
        KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(encoded)); true
    } catch (e: Exception) { false }

    /**
     * Transcript signé lors de l'authentification de session.
     * Il lie la signature : au défi (anti-rejeu), à l'identité de l'appareil, et à
     * l'empreinte du certificat TLS de la tablette (liaison au canal : une signature
     * obtenue par un faux serveur ne serait pas valable pour la vraie tablette).
     */
    fun authTranscript(nonce: ByteArray, deviceId: String, serverFingerprint: ByteArray) =
        transcript("FAMCHAT-AUTH-v1", nonce, deviceId.toByteArray(), serverFingerprint)

    /** Preuve de possession de la clé privée lors de l'appairage. */
    fun pairTranscript(token: String, deviceId: String, serverFingerprint: ByteArray) =
        transcript("FAMCHAT-PAIR-v1", token.toByteArray(), deviceId.toByteArray(), serverFingerprint)

    private fun transcript(label: String, vararg parts: ByteArray): ByteArray {
        val bos = ByteArrayOutputStream()
        val out = DataOutputStream(bos)
        out.writeUTF(label)
        for (p in parts) { out.writeInt(p.size); out.write(p) }   // préfixe de longueur : pas d'ambiguïté
        return bos.toByteArray()
    }

    fun constantTimeEquals(a: ByteArray, b: ByteArray) = MessageDigest.isEqual(a, b)

    fun toHex(b: ByteArray) = b.joinToString("") { "%02x".format(it) }
    fun fromHex(s: String): ByteArray {
        require(s.length % 2 == 0) { "hex invalide" }
        return ByteArray(s.length / 2) { i -> s.substring(2 * i, 2 * i + 2).toInt(16).toByte() }
    }
}
