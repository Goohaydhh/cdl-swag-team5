package fr.ecl.famchat.test

import android.app.Activity
import android.graphics.Typeface
import android.os.Bundle
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import fr.ecl.famchat.android.PairingPrefs
import fr.ecl.famchat.android.PhonePairing
import fr.ecl.famchat.android.PhoneSession
import fr.ecl.famchat.session.client.SessionListener
import fr.ecl.famchat.session.client.SessionState
import fr.ecl.famchat.session.server.TabletStatus
import fr.ecl.famchat.session.wire.Event
import kotlin.concurrent.thread

/**
 * Application de TEST du téléphone parent (une seule activité, interface construite en code).
 *  - pas encore appairé : coller l'invitation (ou l'ouvrir via adb / un QR code : lien famchat://pair?...)
 *  - appairé : état de la session, journal des messages, champ d'envoi
 * La session s'ouvre dans onStart et se ferme dans onStop (usage à la demande).
 */
class MainActivity : Activity() {

    private lateinit var status: TextView
    private lateinit var log: TextView
    private lateinit var input: EditText
    private lateinit var scroll: ScrollView

    private val listener = object : SessionListener {        // rappels déjà reportés sur le thread UI
        override fun onState(state: SessionState, path: String?) {
            status.text = when (state) {
                SessionState.ONLINE -> "● En ligne via ${path ?: "?"}"
                SessionState.OFFLINE -> "○ Hors ligne — ${TabletStatus.UNREACHABLE}"
                SessionState.CONNECTING -> "… Connexion"
                SessionState.CLOSED -> "■ Session fermée"
            }
        }
        override fun onEvent(e: Event) {
            if (e.kind == TabletStatus.KIND) append("⚠ TABLETTE : ${e.text}")
            else append("#${e.seq} ${if (e.origin == PairingPrefs(this@MainActivity).deviceId) "moi" else e.origin} : ${e.text}")
        }
        override fun onSubmitted(clientMsgId: String, seq: Long) = append("   ✓ reçu par la tablette (#$seq)")
        override fun onRejected(clientMsgId: String, reason: String) = append("   ✗ refusé : $reason")
        override fun onFatal(code: Int, reason: String) = append("■ ERREUR FATALE : $reason (réappairage nécessaire)")
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val pad = (16 * resources.displayMetrics.density).toInt()
        status = TextView(this).apply { textSize = 16f; setTypeface(typeface, Typeface.BOLD); text = "…" }
        log = TextView(this).apply { textSize = 14f; setTextIsSelectable(true) }
        scroll = ScrollView(this).apply { addView(log) }
        input = EditText(this).apply {
            hint = "Message, ou invitation famchat://pair?…"
            imeOptions = EditorInfo.IME_ACTION_SEND
            setSingleLine()
            setOnEditorActionListener { _, _, _ -> onSend(); true }
        }
        val send = Button(this).apply { text = "Envoyer"; setOnClickListener { onSend() } }
        val network = Button(this).apply {
            text = "Simuler un changement de réseau"
            setOnClickListener { PhoneSession.client?.onNetworkChanged("bouton de test") }
        }
        setContentView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad, pad, pad)
            addView(status)
            addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
            addView(input)
            addView(LinearLayout(this@MainActivity).apply { addView(send); addView(network) })
            setOnApplyWindowInsetsListener { v, insets ->
                if (android.os.Build.VERSION.SDK_INT >= 30) {
                    val b = insets.getInsets(android.view.WindowInsets.Type.systemBars() or android.view.WindowInsets.Type.ime())
                    v.setPadding(pad + b.left, pad + b.top, pad + b.right, pad + b.bottom)
                }
                insets
            }
        })
        intent?.dataString?.let { if (it.startsWith("famchat://pair")) pair(it) }
    }

    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent)
        intent.dataString?.let { if (it.startsWith("famchat://pair")) pair(it) }
    }

    override fun onStart() {
        super.onStart()
        if (!PhoneSession.open(this, listener)) status.text = "Pas encore appairé : collez l'invitation ci-dessous"
    }

    override fun onStop() {
        PhoneSession.close()
        super.onStop()
    }

    private fun onSend() {
        val text = input.text.toString().trim()
        if (text.isEmpty()) return
        input.setText("")
        if (text.startsWith("famchat://pair")) { pair(text); return }
        val c = PhoneSession.client ?: return append("Pas de session : appairez d'abord le téléphone")
        c.submit("chat.group", text.toByteArray())
        append("→ $text")
    }

    /** L'appairage fait du réseau : jamais sur le thread UI. */
    private fun pair(uri: String) {
        status.text = "Appairage…"
        thread {
            val result = runCatching { PhonePairing.pairFromQr(this, uri, android.os.Build.MODEL) }
            runOnUiThread {
                result.onSuccess {
                    append("Appairé (${it.role}) dans « ${it.familyName} »")
                    PhoneSession.close(); PhoneSession.open(this, listener)
                }.onFailure { append("Échec de l'appairage : ${it.message}"); status.text = "Non appairé" }
            }
        }
    }

    private fun append(line: String) {
        log.append(line + "\n")
        scroll.post { scroll.fullScroll(ScrollView.FOCUS_DOWN) }
    }
}
