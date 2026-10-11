package fr.ecl.famchat.session.wire

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.EOFException
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream

/**
 * Codage binaire TLV (Type-Longueur-Valeur), à la manière des IE des protocoles télécom.
 *
 * Trame sur le fil :
 *   [longueur totale : u32 BE] [type message : u8] [nb champs : u16 BE]
 *     puis pour chaque champ : [tag : u8] [longueur : u32 BE] [valeur]
 *
 * Les tags inconnus sont ignorés à la lecture : on peut ajouter des champs
 * dans une version future sans casser les anciens clients (extensibilité).
 */
class Frame(val type: Int, val fields: Map<Int, ByteArray>) {

    fun bytes(tag: Int): ByteArray = fields[tag] ?: throw ProtocolException("champ $tag absent (type $type)")
    fun bytesOrNull(tag: Int): ByteArray? = fields[tag]
    fun str(tag: Int): String = String(bytes(tag), Charsets.UTF_8)
    fun strOrNull(tag: Int): String? = fields[tag]?.let { String(it, Charsets.UTF_8) }
    fun long(tag: Int): Long {
        val b = bytes(tag)
        if (b.size != 8) throw ProtocolException("champ $tag : 8 octets attendus")
        var v = 0L
        for (x in b) v = (v shl 8) or (x.toLong() and 0xFF)
        return v
    }
    fun int(tag: Int): Int = long(tag).toInt()
    fun bool(tag: Int): Boolean = bytes(tag).let { it.size == 1 && it[0] == 1.toByte() }

    class Builder(private val type: Int) {
        private val fields = LinkedHashMap<Int, ByteArray>()
        fun bytes(tag: Int, v: ByteArray) = apply { fields[tag] = v }
        fun str(tag: Int, v: String) = apply { fields[tag] = v.toByteArray(Charsets.UTF_8) }
        fun strOpt(tag: Int, v: String?) = apply { if (v != null) str(tag, v) }
        fun long(tag: Int, v: Long) = apply {
            fields[tag] = ByteArray(8) { i -> (v ushr (56 - 8 * i)).toByte() }
        }
        fun int(tag: Int, v: Int) = long(tag, v.toLong())
        fun bool(tag: Int, v: Boolean) = apply { fields[tag] = byteArrayOf(if (v) 1 else 0) }
        fun build() = Frame(type, fields)
    }
}

class ProtocolException(msg: String) : IOException(msg)

object Tlv {
    /** Taille maximale d'une trame : protège la tablette contre un pair malveillant. */
    const val MAX_FRAME = 1 shl 20

    fun encode(f: Frame): ByteArray {
        val bos = ByteArrayOutputStream()
        val out = DataOutputStream(bos)
        out.writeByte(f.type)
        out.writeShort(f.fields.size)
        for ((tag, v) in f.fields) {
            out.writeByte(tag)
            out.writeInt(v.size)
            out.write(v)
        }
        out.flush()
        return bos.toByteArray()
    }

    fun decode(b: ByteArray): Frame {
        val inp = DataInputStream(ByteArrayInputStream(b))
        try {
            val type = inp.readUnsignedByte()
            val n = inp.readUnsignedShort()
            val fields = HashMap<Int, ByteArray>(n)
            repeat(n) {
                val tag = inp.readUnsignedByte()
                val len = inp.readInt()
                if (len < 0 || len > b.size) throw ProtocolException("longueur de champ invalide")
                val v = ByteArray(len)
                inp.readFully(v)
                fields[tag] = v
            }
            return Frame(type, fields)
        } catch (e: EOFException) {
            throw ProtocolException("trame tronquée")
        }
    }

    /** Écrit une trame préfixée par sa longueur (framing flux TCP/TLS). */
    fun write(out: OutputStream, f: Frame) {
        val body = encode(f)
        val d = DataOutputStream(out)
        d.writeInt(body.size)
        d.write(body)
        d.flush()
    }

    /** Lit une trame ; EOFException si le flux est fermé proprement. */
    fun read(inp: InputStream): Frame {
        val d = if (inp is DataInputStream) inp else DataInputStream(inp)
        val len = d.readInt()
        if (len <= 0 || len > MAX_FRAME) throw ProtocolException("taille de trame invalide : $len")
        val body = ByteArray(len)
        d.readFully(body)
        return decode(body)
    }
}
