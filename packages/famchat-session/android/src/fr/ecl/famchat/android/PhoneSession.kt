package fr.ecl.famchat.android

import android.content.Context
import android.os.Handler
import android.os.Looper
import fr.ecl.famchat.session.client.ClientConfig
import fr.ecl.famchat.session.client.PairingClient
import fr.ecl.famchat.session.client.PairingRecord
import fr.ecl.famchat.session.client.SessionClient
import fr.ecl.famchat.session.client.SessionListener
import fr.ecl.famchat.session.client.SessionState
import fr.ecl.famchat.session.crypto.Crypto
import fr.ecl.famchat.session.server.PairingInvite
import fr.ecl.famchat.session.store.FileClientStore
import fr.ecl.famchat.session.transport.EndpointBook
import fr.ecl.famchat.session.transport.Paths
import fr.ecl.famchat.session.wire.Event
import fr.ecl.famchat.session.wire.Role
import java.io.File
import java.io.IOException
import java.util.UUID

/** Persistance de l'appairage côté téléphone (aucune donnée personnelle : un UUID et une empreinte). */
class PairingPrefs(context: Context) {
    private val p = context.getSharedPreferences("famchat-pairing", Context.MODE_PRIVATE)

    val deviceId: String
        get() = p.getString("deviceId", null) ?: UUID.randomUUID().toString().also { p.edit().putString("deviceId", it).apply() }

    fun record(): PairingRecord? {
        val fp = p.getString("fp", null) ?: return null
        return PairingRecord(deviceId, Role.valueOf(p.getString("role", "PARENT")!!), p.getString("family", "")!!,
            Crypto.fromHex(fp), p.getString("endpoints", "")!!.lines().filter { it.isNotBlank() })
    }

    fun save(r: PairingRecord) = p.edit().putString("fp", Crypto.toHex(r.fingerprint)).putString("role", r.role.name)
        .putString("family", r.familyName).putString("endpoints", r.endpoints.joinToString("\n")).apply()

    fun saveEndpoints(eps: List<String>) = p.edit().putString("endpoints", eps.joinToString("\n")).apply()
}

object PhonePairing {
    /**
     * Appairage à partir du texte du QR code scanné. BLOQUANT : à appeler hors du thread UI.
     * Le téléphone doit être sur le Wi-Fi de la maison.
     */
    fun pairFromQr(context: Context, qrText: String, displayName: String): PairingRecord {
        val inv = PairingInvite.parse(qrText)
        val prefs = PairingPrefs(context)
        val link = Paths.firstReachable(Paths.forPairing(EndpointBook(inv.fingerprint, inv.endpoints).candidates()), 5_000, AndroidLog)
            ?: throw IOException("tablette injoignable : vérifiez que le téléphone est sur le Wi-Fi de la maison")
        // Toutes les extrémités sont gardées : une adresse périmée échoue simplement à l'épinglage TLS.
        return PairingClient.pair(inv, link, prefs.deviceId, KeystoreDeviceSigner(), displayName).also { prefs.save(it) }
    }
}

/**
 * TÉLÉPHONE : session liée à la vie de l'application. Pas de service en arrière-plan :
 * la session s'ouvre quand le parent ouvre l'application et se ferme quand il la quitte.
 *
 *   override fun onStart() { super.onStart(); PhoneSession.open(this, monListener) }
 *   override fun onStop()  { PhoneSession.close(); super.onStop() }
 *
 * Les messages écrits restent dans la file d'attente persistante tant que la tablette n'a pas
 * acquitté ; ils partent à la prochaine ouverture si l'application a été fermée entre-temps.
 *
 * État de la tablette à afficher en bandeau :
 *  - événement e.kind == TabletStatus.KIND → afficher e.text
 *    (ex. « application non démarrée sur la tablette ») ;
 *  - état OFFLINE après une tentative → afficher TabletStatus.UNREACHABLE : si la tablette
 *    est éteinte ou l'application arrêtée de force, elle ne peut plus rien envoyer.
 */
object PhoneSession {
    var client: SessionClient? = null; private set
    private var store: FileClientStore? = null
    private var browser: NsdBrowser? = null
    private var watcher: NetworkWatcher? = null

    /** @return false si le téléphone n'est pas encore appairé (afficher l'écran de scan du QR). */
    fun open(context: Context, ui: SessionListener): Boolean {
        if (client != null) return true
        val app = context.applicationContext
        val prefs = PairingPrefs(app)
        val rec = prefs.record() ?: return false
        val main = Handler(Looper.getMainLooper())

        val st = FileClientStore(File(app.filesDir, "session")).also { store = it }
        val nsd = NsdBrowser(app, Crypto.toHex(rec.fingerprint)) { client?.onNetworkChanged("tablette vue sur le LAN") }
        val book = EndpointBook(rec.fingerprint, rec.endpoints, nsd::resolved)

        val toUi = object : SessionListener {            // les rappels arrivent sur le fil de session
            override fun onState(state: SessionState, path: String?) { main.post { ui.onState(state, path) } }
            override fun onEvent(e: Event) {
                if (e.kind == "sys.endpoints") prefs.saveEndpoints(book.all())
                main.post { ui.onEvent(e) }
            }
            override fun onSubmitted(clientMsgId: String, seq: Long) { main.post { ui.onSubmitted(clientMsgId, seq) } }
            override fun onRejected(clientMsgId: String, reason: String) { main.post { ui.onRejected(clientMsgId, reason) } }
            override fun onFatal(code: Int, reason: String) { main.post { ui.onFatal(code, reason) } }
        }

        val c = SessionClient(ClientConfig(rec.deviceId, KeystoreDeviceSigner(), rec.fingerprint),
            st, book::candidates, toUi, AndroidLog, book)
        client = c
        browser = nsd.also { it.start() }
        watcher = NetworkWatcher(app, addressChanges = false) { reason, _ -> c.onNetworkChanged(reason) }.also { it.start() }
        c.start()
        return true
    }

    fun close() {
        client?.stop(); client = null
        watcher?.stop(); browser?.stop(); store?.close()
        watcher = null; browser = null; store = null
    }
}
