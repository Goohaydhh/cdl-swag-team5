package fr.ecl.famchat.session.store

import fr.ecl.famchat.session.wire.Event
import fr.ecl.famchat.session.wire.Frame
import fr.ecl.famchat.session.wire.Msg
import fr.ecl.famchat.session.wire.Role
import fr.ecl.famchat.session.wire.Tlv
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile

/**
 * Persistance sur fichiers, sans dépendance :
 *  - journal d'événements en ajout seul (append-only), une trame TLV par événement, fsync ;
 *  - petits fichiers d'état réécrits de façon atomique (fichier temporaire + rename).
 * Au rechargement, un enregistrement tronqué par une coupure de courant est détecté et
 * retiré : le journal reste cohérent, et lastSeq se déduit du journal lui-même.
 *
 * Sur Android, `dir` = context.filesDir/<sous-dossier> (stockage privé de l'application).
 * On peut remplacer ces classes par Room/SQLite sans toucher au reste du module.
 */
internal object FileIo {
    fun atomicWrite(target: File, frames: List<Frame>) {
        val bos = ByteArrayOutputStream()
        frames.forEach { Tlv.write(bos, it) }
        val tmp = File(target.parentFile, target.name + ".tmp")
        FileOutputStream(tmp).use { it.write(bos.toByteArray()); it.fd.sync() }
        if (!tmp.renameTo(target)) {               // rename est atomique sur un même système de fichiers
            target.delete(); check(tmp.renameTo(target)) { "rename impossible : $target" }
        }
    }

    /** Lit toutes les trames valides ; tronque le fichier après la dernière trame complète. */
    fun readFrames(f: File, truncateTorn: Boolean = true): List<Frame> {
        if (!f.exists()) return emptyList()
        val b = f.readBytes()
        val out = ArrayList<Frame>()
        var off = 0
        while (b.size - off >= 4) {
            val len = ((b[off].toInt() and 0xFF) shl 24) or ((b[off + 1].toInt() and 0xFF) shl 16) or
                      ((b[off + 2].toInt() and 0xFF) shl 8) or (b[off + 3].toInt() and 0xFF)
            if (len <= 0 || len > Tlv.MAX_FRAME || b.size - off - 4 < len) break
            try { out += Tlv.decode(b.copyOfRange(off + 4, off + 4 + len)) } catch (e: Exception) { break }
            off += 4 + len
        }
        if (truncateTorn && off < b.size) RandomAccessFile(f, "rw").use { it.setLength(off.toLong()) }
        return out
    }

    class AppendLog(private val f: File) {
        private var out = FileOutputStream(f, true)
        fun append(frame: Frame) {
            val bos = ByteArrayOutputStream(); Tlv.write(bos, frame)
            out.write(bos.toByteArray()); out.fd.sync()
        }
        fun close() = out.close()
    }

    const val T_OUTBOX = 100; const val T_DEVICE = 101; const val T_SESSION = 102; const val T_STATE = 103
}

class FileClientStore(dir: File) : ClientStore {
    private val lock = Any()
    private val stateFile = File(dir, "state.bin")
    private val outboxFile = File(dir, "outbox.bin")
    private val evs = ArrayList<Event>()
    private val out = LinkedHashMap<String, OutboxItem>()
    private val log: FileIo.AppendLog
    @Volatile private var sid: String? = null
    @Volatile override var lastSeq: Long = 0; private set

    init {
        dir.mkdirs()
        val logFile = File(dir, "events.log")
        for (f in FileIo.readFrames(logFile)) {
            val e = Msg.decodeEvent(f)
            if (e.seq > lastSeq) { evs += e; lastSeq = e.seq }
        }
        log = FileIo.AppendLog(logFile)
        FileIo.readFrames(stateFile).firstOrNull()?.let { sid = it.strOrNull(1) }
        for (f in FileIo.readFrames(outboxFile)) {
            val it = OutboxItem(f.str(1), f.str(2), f.bytes(3), f.long(4))
            out[it.id] = it
        }
    }

    override var sessionId: String?
        get() = sid
        set(v) = synchronized(lock) {
            sid = v
            FileIo.atomicWrite(stateFile, listOf(Frame.Builder(FileIo.T_STATE).strOpt(1, v).build()))
        }

    override fun applyEvent(e: Event) {
        synchronized(lock) {
            if (e.seq <= lastSeq) return
            log.append(Msg.encodeEvent(e))          // persisté AVANT d'avancer lastSeq
            evs += e; lastSeq = e.seq
        }
    }
    override fun events(afterSeq: Long) = synchronized(lock) { evs.filter { it.seq > afterSeq } }

    override fun outboxAdd(item: OutboxItem) = synchronized(lock) { out[item.id] = item; flushOutbox() }
    override fun outboxRemove(id: String) { synchronized(lock) { if (out.remove(id) != null) flushOutbox() } }
    override fun outbox() = synchronized(lock) { out.values.toList() }

    private fun flushOutbox() = FileIo.atomicWrite(outboxFile, out.values.map {
        Frame.Builder(FileIo.T_OUTBOX).str(1, it.id).str(2, it.kind).bytes(3, it.payload).long(4, it.createdAt).build()
    })

    fun close() = log.close()
}

class FileServerStore(dir: File) : ServerStore {
    private val lock = Any()
    private val devicesFile = File(dir, "devices.bin")
    private val sessionsFile = File(dir, "sessions.bin")
    private val devs = LinkedHashMap<String, Device>()
    private val evs = ArrayList<Event>()
    private val index = HashMap<String, Event>()
    private val sessions = LinkedHashMap<String, String>()
    private val log: FileIo.AppendLog

    init {
        dir.mkdirs()
        val logFile = File(dir, "events.log")
        for (f in FileIo.readFrames(logFile)) {
            val e = Msg.decodeEvent(f)
            evs += e; index["${e.origin}/${e.eventId}"] = e
        }
        log = FileIo.AppendLog(logFile)
        for (f in FileIo.readFrames(devicesFile)) {
            val d = Device(f.str(1), f.bytes(2), Role.valueOf(f.str(3)), f.str(4), f.long(5), f.bool(6))
            devs[d.id] = d
        }
        for (f in FileIo.readFrames(sessionsFile)) sessions[f.str(1)] = f.str(2)
    }

    override fun devices() = synchronized(lock) { devs.values.toList() }
    override fun putDevice(d: Device) = synchronized(lock) {
        devs[d.id] = d
        FileIo.atomicWrite(devicesFile, devs.values.map {
            Frame.Builder(FileIo.T_DEVICE).str(1, it.id).bytes(2, it.publicKey).str(3, it.role.name)
                .str(4, it.name).long(5, it.pairedAt).bool(6, it.revoked).build()
        })
    }
    override fun headSeq() = synchronized(lock) { evs.lastOrNull()?.seq ?: 0L }
    override fun append(origin: String, eventId: String, kind: String, payload: ByteArray, ts: Long) =
        synchronized(lock) {
            val e = Event(headSeq() + 1, eventId, origin, kind, payload, ts)
            log.append(Msg.encodeEvent(e))
            evs += e; index["$origin/$eventId"] = e; e
        }
    override fun eventsAfter(seq: Long, limit: Int) = synchronized(lock) {
        evs.asSequence().filter { it.seq > seq }.take(limit).toList()
    }
    override fun findEvent(origin: String, eventId: String) = synchronized(lock) { index["$origin/$eventId"] }
    override fun sessionOf(deviceId: String) = synchronized(lock) { sessions[deviceId] }
    override fun putSession(deviceId: String, sessionId: String) = synchronized(lock) {
        sessions[deviceId] = sessionId
        FileIo.atomicWrite(sessionsFile, sessions.map { (k, v) ->
            Frame.Builder(FileIo.T_SESSION).str(1, k).str(2, v).build()
        })
    }

    fun close() = log.close()
}
