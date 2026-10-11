package fr.ecl.famchat.session.client

import fr.ecl.famchat.session.crypto.Crypto
import fr.ecl.famchat.session.crypto.DeviceSigner
import fr.ecl.famchat.session.server.PairingInvite
import fr.ecl.famchat.session.transport.Transport
import fr.ecl.famchat.session.wire.Msg
import fr.ecl.famchat.session.wire.Role
import java.io.IOException

/** Ce que le téléphone doit conserver après l'appairage (à persister). */
class PairingRecord(
    val deviceId: String,
    val role: Role,
    val familyName: String,
    val fingerprint: ByteArray,
    val endpoints: List<String>,
)

object PairingClient {
    /**
     * Appairage du téléphone avec la tablette, sur le LAN, à partir du QR scanné.
     * @param transport lien TLS déjà établi et ÉPINGLÉ sur invite.fingerprint
     *                  (ex. EndpointBook(invite.fingerprint, listOf("lan"), resolver).candidates())
     */
    fun pair(invite: PairingInvite, transport: Transport, deviceId: String, signer: DeviceSigner, displayName: String): PairingRecord {
        if (System.currentTimeMillis() > invite.expiresAt) throw IOException("invitation expirée, régénérez le QR code")
        try {
            val proof = signer.sign(Crypto.pairTranscript(invite.token, deviceId, invite.fingerprint))
            transport.send(Msg.PairReq(invite.token, deviceId, signer.publicKeyEncoded, displayName, proof))
            return when (val r = transport.receive()) {
                is Msg.PairOk -> PairingRecord(deviceId, r.role, r.familyName, invite.fingerprint, invite.endpoints)
                is Msg.Error -> throw IOException("appairage refusé : ${r.detail}")
                else -> throw IOException("réponse inattendue : $r")
            }
        } finally {
            transport.close()
        }
    }
}
