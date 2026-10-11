package fr.ecl.famchat.session.store

import fr.ecl.famchat.session.wire.Event
import java.time.Instant

/**
 * Export lisible du journal en XML (sauvegarde, annexe du rapport, débogage).
 * Le format de travail reste le journal TLV, plus robuste aux coupures ; l'XML est une vue.
 */
object XmlExport {
    fun events(events: List<Event>, family: String): String = buildString {
        append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n")
        append("<famchat family=\"").append(esc(family)).append("\" exportedAt=\"")
            .append(Instant.now()).append("\">\n")
        for (e in events) {
            append("  <event seq=\"").append(e.seq)
                .append("\" id=\"").append(esc(e.eventId))
                .append("\" origin=\"").append(esc(e.origin))
                .append("\" kind=\"").append(esc(e.kind))
                .append("\" ts=\"").append(Instant.ofEpochMilli(e.ts)).append("\">")
                .append(esc(e.text)).append("</event>\n")
        }
        append("</famchat>\n")
    }

    private fun esc(s: String) = buildString {
        for (c in s) when (c) {
            '<' -> append("&lt;"); '>' -> append("&gt;"); '&' -> append("&amp;")
            '"' -> append("&quot;"); '\'' -> append("&apos;")
            else -> if (c.code < 0x20 && c != '\n' && c != '\t') append(' ') else append(c)
        }
    }
}
