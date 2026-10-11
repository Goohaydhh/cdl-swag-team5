package fr.ecl.famchat.session.wire

/** Version du protocole de session. Incrémentée à chaque changement incompatible. */
const val PROTO_VERSION = 1

enum class Role { ADMIN, PARENT, CHILD, SYSTEM }

/**
 * Événement applicatif ordonné par la tablette (source de vérité).
 * seq    : numéro de séquence global, strictement croissant (point de synchronisation OSI-5)
 * eventId: identifiant choisi par l'émetteur (clientMsgId) — sert à l'idempotence
 */
class Event(
    val seq: Long,
    val eventId: String,
    val origin: String,
    val kind: String,
    val payload: ByteArray,
    val ts: Long,
) {
    val text: String get() = String(payload, Charsets.UTF_8)
    override fun toString() = "Event#$seq($kind from $origin: ${text.take(40)})"
}

/** Codes d'erreur du protocole. Les codes FATAL interdisent la reconnexion automatique. */
object ErrorCode {
    const val UNKNOWN_DEVICE = 1     // fatal : appareil non appairé ou révoqué
    const val BAD_SIGNATURE = 2      // fatal
    const val BAD_PROTO = 3          // fatal : version incompatible
    const val FORBIDDEN = 4          // action refusée par la politique de rôles (non fatal)
    const val PAIRING_REFUSED = 5
    const val SUPERSEDED = 6         // une nouvelle connexion du même appareil remplace celle-ci
    const val INTERNAL = 7
    fun isFatal(c: Int) = c == UNKNOWN_DEVICE || c == BAD_SIGNATURE || c == BAD_PROTO
}

sealed class Msg {
    // --- Établissement de session -------------------------------------------------------
    class Hello(val deviceId: String, val proto: Int, val prevSessionId: String?, val lastSeq: Long) : Msg()
    class Challenge(val nonce: ByteArray) : Msg()
    class Auth(val signature: ByteArray) : Msg()
    class AuthOk(val sessionId: String, val headSeq: Long, val resumed: Boolean, val role: Role) : Msg()
    class SyncDone(val headSeq: Long) : Msg()

    // --- Appairage (une seule fois, sur le LAN) ------------------------------------------
    class PairReq(
        val token: String, val deviceId: String, val publicKey: ByteArray,
        val displayName: String, val proof: ByteArray,
    ) : Msg()
    class PairOk(val role: Role, val familyName: String) : Msg()

    // --- Transfert de données --------------------------------------------------------------
    class Submit(val clientMsgId: String, val kind: String, val payload: ByteArray) : Msg()
    class SubmitAck(val clientMsgId: String, val seq: Long) : Msg()
    class EventMsg(val event: Event) : Msg()

    // --- Maintien et libération ----------------------------------------------------------
    class Ping(val t: Long) : Msg()
    class Pong(val t: Long) : Msg()
    class Bye(val reason: String) : Msg()
    class Error(val code: Int, val detail: String, val ref: String?) : Msg()

    override fun toString(): String = javaClass.simpleName

    companion object {
        // Types de message (octet "type" de la trame)
        private const val T_HELLO = 1; private const val T_CHALLENGE = 2; private const val T_AUTH = 3
        private const val T_AUTH_OK = 4; private const val T_SYNC_DONE = 5
        private const val T_PAIR_REQ = 10; private const val T_PAIR_OK = 11
        private const val T_SUBMIT = 20; private const val T_SUBMIT_ACK = 21
        private const val T_EVENT = 22
        private const val T_PING = 30; private const val T_PONG = 31
        private const val T_BYE = 40; private const val T_ERROR = 41

        // Tags de champs (IE)
        private const val F_DEVICE = 1; private const val F_PROTO = 2; private const val F_SESSION = 3
        private const val F_SEQ = 4; private const val F_NONCE = 5; private const val F_SIG = 6
        private const val F_RESUMED = 7; private const val F_ROLE = 8; private const val F_TOKEN = 9
        private const val F_PUBKEY = 10; private const val F_NAME = 11; private const val F_ID = 12
        private const val F_KIND = 13; private const val F_PAYLOAD = 14; private const val F_ORIGIN = 15
        private const val F_TS = 16; private const val F_CODE = 17; private const val F_DETAIL = 18
        private const val F_REF = 19; private const val F_PROOF = 20

        fun encodeEvent(e: Event): Frame = Frame.Builder(T_EVENT)
            .long(F_SEQ, e.seq).str(F_ID, e.eventId).str(F_ORIGIN, e.origin)
            .str(F_KIND, e.kind).bytes(F_PAYLOAD, e.payload).long(F_TS, e.ts).build()

        fun decodeEvent(f: Frame) = Event(
            f.long(F_SEQ), f.str(F_ID), f.str(F_ORIGIN), f.str(F_KIND), f.bytes(F_PAYLOAD), f.long(F_TS),
        )

        fun toFrame(m: Msg): Frame = when (m) {
            is Hello -> Frame.Builder(T_HELLO).str(F_DEVICE, m.deviceId).int(F_PROTO, m.proto)
                .strOpt(F_SESSION, m.prevSessionId).long(F_SEQ, m.lastSeq).build()
            is Challenge -> Frame.Builder(T_CHALLENGE).bytes(F_NONCE, m.nonce).build()
            is Auth -> Frame.Builder(T_AUTH).bytes(F_SIG, m.signature).build()
            is AuthOk -> Frame.Builder(T_AUTH_OK).str(F_SESSION, m.sessionId).long(F_SEQ, m.headSeq)
                .bool(F_RESUMED, m.resumed).str(F_ROLE, m.role.name).build()
            is SyncDone -> Frame.Builder(T_SYNC_DONE).long(F_SEQ, m.headSeq).build()
            is PairReq -> Frame.Builder(T_PAIR_REQ).str(F_TOKEN, m.token).str(F_DEVICE, m.deviceId)
                .bytes(F_PUBKEY, m.publicKey).str(F_NAME, m.displayName).bytes(F_PROOF, m.proof).build()
            is PairOk -> Frame.Builder(T_PAIR_OK).str(F_ROLE, m.role.name).str(F_NAME, m.familyName).build()
            is Submit -> Frame.Builder(T_SUBMIT).str(F_ID, m.clientMsgId).str(F_KIND, m.kind)
                .bytes(F_PAYLOAD, m.payload).build()
            is SubmitAck -> Frame.Builder(T_SUBMIT_ACK).str(F_ID, m.clientMsgId).long(F_SEQ, m.seq).build()
            is EventMsg -> encodeEvent(m.event)
            is Ping -> Frame.Builder(T_PING).long(F_TS, m.t).build()
            is Pong -> Frame.Builder(T_PONG).long(F_TS, m.t).build()
            is Bye -> Frame.Builder(T_BYE).str(F_DETAIL, m.reason).build()
            is Error -> Frame.Builder(T_ERROR).int(F_CODE, m.code).str(F_DETAIL, m.detail)
                .strOpt(F_REF, m.ref).build()
        }

        fun fromFrame(f: Frame): Msg = when (f.type) {
            T_HELLO -> Hello(f.str(F_DEVICE), f.int(F_PROTO), f.strOrNull(F_SESSION), f.long(F_SEQ))
            T_CHALLENGE -> Challenge(f.bytes(F_NONCE))
            T_AUTH -> Auth(f.bytes(F_SIG))
            T_AUTH_OK -> AuthOk(f.str(F_SESSION), f.long(F_SEQ), f.bool(F_RESUMED), Role.valueOf(f.str(F_ROLE)))
            T_SYNC_DONE -> SyncDone(f.long(F_SEQ))
            T_PAIR_REQ -> PairReq(f.str(F_TOKEN), f.str(F_DEVICE), f.bytes(F_PUBKEY), f.str(F_NAME), f.bytes(F_PROOF))
            T_PAIR_OK -> PairOk(Role.valueOf(f.str(F_ROLE)), f.str(F_NAME))
            T_SUBMIT -> Submit(f.str(F_ID), f.str(F_KIND), f.bytes(F_PAYLOAD))
            T_SUBMIT_ACK -> SubmitAck(f.str(F_ID), f.long(F_SEQ))
            T_EVENT -> EventMsg(decodeEvent(f))
            T_PING -> Ping(f.long(F_TS))
            T_PONG -> Pong(f.long(F_TS))
            T_BYE -> Bye(f.str(F_DETAIL))
            T_ERROR -> Error(f.int(F_CODE), f.str(F_DETAIL), f.strOrNull(F_REF))
            else -> throw ProtocolException("type de message inconnu : ${f.type}")
        }
    }
}
