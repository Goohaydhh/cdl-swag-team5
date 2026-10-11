package fr.ecl.famchat.android

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import fr.ecl.famchat.session.crypto.Crypto
import fr.ecl.famchat.session.server.PairingInvite
import fr.ecl.famchat.session.server.ServerConfig
import fr.ecl.famchat.session.server.SessionServer
import fr.ecl.famchat.session.server.TabletStatus
import fr.ecl.famchat.session.store.FileServerStore
import fr.ecl.famchat.session.transport.EndpointBook
import fr.ecl.famchat.session.wire.Role
import java.io.File
import java.net.Inet4Address

/**
 * TABLETTE : service au premier plan qui héberge le serveur de session, indépendamment de
 * l'écran de l'enfant.
 *  - démarré au premier lancement de l'application (Android n'exécute aucun code à
 *    l'installation), puis à chaque démarrage de la tablette et après chaque mise à jour ;
 *  - continue de tourner quand l'enfant ferme l'application ; les parents reçoivent alors
 *    « application non démarrée sur la tablette » ;
 *  - type "specialUse" (dataSync est limité à 6 h/24 h depuis Android 15).
 *
 * Réglages à faire une fois sur la tablette Samsung :
 *  - Paramètres > Applications > FamChat > Batterie : « Non restreinte » ;
 *  - Entretien de l'appareil > Batterie > Limites d'utilisation en arrière-plan :
 *    ajouter FamChat aux « Applications jamais en veille » ;
 *  - tablette sur secteur.
 */
class TabletServerService : Service() {

    companion object {
        const val PORT = 8443
        private const val NOTIF_ID = 1
        /** Accès simple pour l'interface de la tablette (une liaison Binder conviendrait aussi). */
        @Volatile var instance: TabletServerService? = null; private set

        private const val ACTION_APP = "fr.ecl.famchat.APP"
        private const val EXTRA_OPEN = "open"
        const val EXTRA_BOOT = "boot"

        /** À appeler par l'écran de l'enfant : ouvert (onCreate) / fermé (onDestroy si isFinishing). */
        fun appVisible(context: Context, open: Boolean) {
            val i = Intent(context, TabletServerService::class.java).setAction(ACTION_APP).putExtra(EXTRA_OPEN, open)
            if (open) context.startForegroundService(i) else context.startService(i)
        }
    }

    lateinit var server: SessionServer; private set
    private lateinit var store: FileServerStore
    private lateinit var identity: TabletTlsIdentity
    private var nsd: NsdAdvertiser? = null
    private var watcher: NetworkWatcher? = null
    private var wifiLock: WifiManager.WifiLock? = null
    @Volatile private var published: List<String> = emptyList()
    @Volatile private var appOpen: Boolean? = null
    /** Adresse du service onion si Tor est démarré (voir README, section Tor). */
    @Volatile var onionHost: String? = null

    override fun onCreate() {
        super.onCreate()
        if (Build.VERSION.SDK_INT >= 34) startForeground(NOTIF_ID, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        else startForeground(NOTIF_ID, notification())

        identity = TabletTlsIdentity()
        store = FileServerStore(File(filesDir, "server"))
        server = SessionServer(ServerConfig(port = PORT, familyName = familyName()),
            identity.serverContext(), identity.fingerprint, store, AndroidLog)
        server.start()

        // Le Wi-Fi ne doit pas s'assoupir : sinon la tablette devient injoignable écran éteint.
        val wm = applicationContext.getSystemService(WifiManager::class.java)
        @Suppress("DEPRECATION")
        val mode = if (Build.VERSION.SDK_INT >= 29) WifiManager.WIFI_MODE_FULL_LOW_LATENCY else WifiManager.WIFI_MODE_FULL_HIGH_PERF
        wifiLock = wm.createWifiLock(mode, "famchat:server").apply { setReferenceCounted(false); acquire() }

        nsd = NsdAdvertiser(this, PORT, Crypto.toHex(identity.fingerprint)).also { it.start() }

        // Changement de préfixe IPv6 (redémarrage de la box…) → publication en bande aux téléphones
        watcher = NetworkWatcher(this) { _, lp -> publishIfChanged(lp) }.also { it.start() }
        instance = this
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when {
            intent?.action == ACTION_APP -> setAppOpen(intent.getBooleanExtra(EXTRA_OPEN, false))
            intent?.getBooleanExtra(EXTRA_BOOT, false) == true -> setAppOpen(false)   // démarrage sans l'enfant
        }
        return START_STICKY                    // relancé par Android s'il est tué faute de mémoire
    }

    /** L'enfant balaie l'application depuis les « applications récentes » : le serveur continue. */
    override fun onTaskRemoved(rootIntent: Intent?) = setAppOpen(false)

    override fun onDestroy() {
        instance = null
        server.publishStatus(TabletStatus.SERVER_STOPPED)   // part avant la fermeture des connexions
        watcher?.stop(); nsd?.stop(); wifiLock?.release()
        server.stop(); store.close()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    // ------------------------------------------------------------------------------------

    /** Extrémités durables (vont dans le carnet du téléphone). */
    fun endpoints(lp: LinkProperties? = currentLinkProperties()): List<String> =
        listOf("lan") + Ipv6Endpoints.stableGlobal(lp, PORT) + listOfNotNull(onionHost?.let { "onion:$it:$PORT" })

    /**
     * Invitation affichée en QR code (ZXing). On y ajoute l'adresse LAN actuelle pour que
     * le téléphone puisse s'appairer sans attendre la découverte mDNS.
     */
    fun createInvite(role: Role): PairingInvite {
        val lp = currentLinkProperties()
        val lanNow = lp?.linkAddresses.orEmpty().map { it.address }
            .filter { it is Inet4Address && it.isSiteLocalAddress }
            .map { EndpointBook.formatIp(it.hostAddress!!, PORT) }
        return server.createPairingInvite(role, endpoints(lp) + lanNow)
    }

    /** Ne publie qu'aux changements : pas de message répété à chaque passage à l'écran. */
    private fun setAppOpen(open: Boolean) {
        if (appOpen == open) return
        appOpen = open
        server.publishStatus(if (open) TabletStatus.APP_OPEN else TabletStatus.APP_CLOSED)
    }

    private fun publishIfChanged(lp: LinkProperties?) {
        val eps = endpoints(lp)
        if (eps != published) { published = eps; server.publishEndpoints(eps) }
    }

    private fun currentLinkProperties(): LinkProperties? {
        val cm = getSystemService(ConnectivityManager::class.java)
        return cm.activeNetwork?.let { cm.getLinkProperties(it) }
    }

    private fun familyName() = getSharedPreferences("famchat", MODE_PRIVATE).getString("family", "Famille")!!

    private fun notification(): Notification {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel("server", "Serveur FamChat", NotificationManager.IMPORTANCE_LOW))
        return NotificationCompat.Builder(this, "server")
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setContentTitle("FamChat actif")
            .setContentText("Les parents peuvent joindre la tablette")
            .setOngoing(true)
            .build()
    }
}

/**
 * Relance du serveur au démarrage de la tablette et après une mise à jour de l'application.
 * NB : Android ne délivre ces événements qu'à une application lancée au moins une fois.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED || intent.action == Intent.ACTION_MY_PACKAGE_REPLACED) {
            context.startForegroundService(Intent(context, TabletServerService::class.java)
                .putExtra(TabletServerService.EXTRA_BOOT, true))
        }
    }
}
