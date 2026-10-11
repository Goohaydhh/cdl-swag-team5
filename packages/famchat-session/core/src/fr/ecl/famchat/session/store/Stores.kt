package fr.ecl.famchat.session.store

import fr.ecl.famchat.session.wire.Event
import fr.ecl.famchat.session.wire.Role

/** Message en attente d'acquittement par la tablette (file d'attente sortante persistante). */
class OutboxItem(val id: String, val kind: String, val payload: ByteArray, val createdAt: Long)

/** Persistance côté téléphone. Les implémentations doivent être thread-safe. */
interface ClientStore {
    var sessionId: String?
    /** Dernier numéro de séquence appliqué localement (point de synchronisation). */
    val lastSeq: Long
    /** Idempotent : ignoré si e.seq <= lastSeq. */
    fun applyEvent(e: Event)
    fun events(afterSeq: Long = 0): List<Event>
    fun outboxAdd(item: OutboxItem)
    fun outboxRemove(id: String)
    fun outbox(): List<OutboxItem>
}

class Device(
    val id: String,
    val publicKey: ByteArray,
    val role: Role,
    val name: String,
    val pairedAt: Long,
    val revoked: Boolean = false,
)

/** Persistance côté tablette (source de vérité). Thread-safe. */
interface ServerStore {
    fun devices(): List<Device>
    fun device(id: String): Device? = devices().firstOrNull { it.id == id }
    fun putDevice(d: Device)
    fun headSeq(): Long
    /** Attribue le prochain numéro de séquence et persiste l'événement. */
    fun append(origin: String, eventId: String, kind: String, payload: ByteArray, ts: Long): Event
    fun eventsAfter(seq: Long, limit: Int = Int.MAX_VALUE): List<Event>
    /** Recherche pour l'idempotence des Submit (même appareil + même clientMsgId). */
    fun findEvent(origin: String, eventId: String): Event?
    fun sessionOf(deviceId: String): String?
    fun putSession(deviceId: String, sessionId: String)
}

// ---------------------------------------------------------------------------------------
// Implémentations en mémoire (tests unitaires, prototypage)
// ---------------------------------------------------------------------------------------

class MemoryClientStore : ClientStore {
    private val lock = Any()
    private val evs = ArrayList<Event>()
    private val out = LinkedHashMap<String, OutboxItem>()
    @Volatile override var sessionId: String? = null
    @Volatile override var lastSeq: Long = 0; private set

    override fun applyEvent(e: Event) {
        synchronized(lock) {
            if (e.seq <= lastSeq) return
            evs += e; lastSeq = e.seq
        }
    }
    override fun events(afterSeq: Long) = synchronized(lock) { evs.filter { it.seq > afterSeq } }
    override fun outboxAdd(item: OutboxItem) { synchronized(lock) { out[item.id] = item } }
    override fun outboxRemove(id: String) { synchronized(lock) { out.remove(id) } }
    override fun outbox() = synchronized(lock) { out.values.toList() }
}

class MemoryServerStore : ServerStore {
    private val lock = Any()
    private val devs = LinkedHashMap<String, Device>()
    private val evs = ArrayList<Event>()
    private val index = HashMap<String, Event>()
    private val sessions = HashMap<String, String>()

    override fun devices() = synchronized(lock) { devs.values.toList() }
    override fun putDevice(d: Device) { synchronized(lock) { devs[d.id] = d } }
    override fun headSeq() = synchronized(lock) { evs.lastOrNull()?.seq ?: 0L }
    override fun append(origin: String, eventId: String, kind: String, payload: ByteArray, ts: Long) =
        synchronized(lock) {
            val e = Event(headSeq() + 1, eventId, origin, kind, payload, ts)
            evs += e; index["$origin/$eventId"] = e; e
        }
    override fun eventsAfter(seq: Long, limit: Int) = synchronized(lock) {
        evs.asSequence().filter { it.seq > seq }.take(limit).toList()
    }
    override fun findEvent(origin: String, eventId: String) = synchronized(lock) { index["$origin/$eventId"] }
    override fun sessionOf(deviceId: String) = synchronized(lock) { sessions[deviceId] }
    override fun putSession(deviceId: String, sessionId: String) { synchronized(lock) { sessions[deviceId] = sessionId } }
}
