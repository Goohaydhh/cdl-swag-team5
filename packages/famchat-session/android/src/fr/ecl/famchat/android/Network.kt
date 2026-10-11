package fr.ecl.famchat.android

import android.content.Context
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.Network
import android.net.NetworkCapabilities
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.system.OsConstants
import fr.ecl.famchat.session.transport.EndpointBook
import java.net.Inet6Address
import java.net.InetSocketAddress
import java.util.concurrent.atomic.AtomicReference

const val NSD_TYPE = "_famchat._tcp."

/**
 * TABLETTE : annonce DNS-SD/mDNS du service sur le Wi-Fi de la maison.
 * Le nom d'instance contient un préfixe de l'empreinte : le téléphone ne retient que
 * SA tablette, même si un voisin utilise la même application.
 */
class NsdAdvertiser(context: Context, private val port: Int, fingerprintHex: String) {
    private val nsd = context.getSystemService(NsdManager::class.java)
    private val info = NsdServiceInfo().apply {
        serviceName = "famchat-" + fingerprintHex.take(12)
        serviceType = NSD_TYPE
        setPort(port)
    }
    private val listener = object : NsdManager.RegistrationListener {
        override fun onServiceRegistered(i: NsdServiceInfo) { AndroidLog.d("nsd", "annoncé : ${i.serviceName}") }
        override fun onRegistrationFailed(i: NsdServiceInfo, err: Int) { AndroidLog.d("nsd", "échec annonce $err") }
        override fun onServiceUnregistered(i: NsdServiceInfo) {}
        override fun onUnregistrationFailed(i: NsdServiceInfo, err: Int) {}
    }
    fun start() = nsd.registerService(info, NsdManager.PROTOCOL_DNS_SD, listener)
    fun stop() = runCatching { nsd.unregisterService(listener) }
}

/**
 * TÉLÉPHONE : découverte de la tablette sur le Wi-Fi courant. Le résultat alimente le
 * chemin "lan" de l'EndpointBook (lanResolver). Il est effacé quand le service disparaît.
 */
class NsdBrowser(context: Context, fingerprintHex: String, private val onChange: () -> Unit) {
    private val nsd = context.getSystemService(NsdManager::class.java)
    private val wanted = "famchat-" + fingerprintHex.take(12)
    private val current = AtomicReference<InetSocketAddress?>(null)

    /** À passer à EndpointBook(lanResolver = browser::resolved). */
    fun resolved(): InetSocketAddress? = current.get()

    private val discovery = object : NsdManager.DiscoveryListener {
        override fun onDiscoveryStarted(t: String) {}
        override fun onDiscoveryStopped(t: String) {}
        override fun onStartDiscoveryFailed(t: String, e: Int) { AndroidLog.d("nsd", "découverte KO $e") }
        override fun onStopDiscoveryFailed(t: String, e: Int) {}
        override fun onServiceFound(s: NsdServiceInfo) {
            if (s.serviceName != wanted) return
            @Suppress("DEPRECATION")   // API 34+ : registerServiceInfoCallback, même principe
            nsd.resolveService(s, object : NsdManager.ResolveListener {
                override fun onResolveFailed(i: NsdServiceInfo, e: Int) { AndroidLog.d("nsd", "résolution KO $e") }
                override fun onServiceResolved(i: NsdServiceInfo) {
                    @Suppress("DEPRECATION")
                    current.set(InetSocketAddress(i.host, i.port))
                    AndroidLog.d("nsd", "tablette vue sur le LAN : ${i.host}:${i.port}")
                    onChange()                      // → client.onNetworkChanged("tablette visible sur le LAN")
                }
            })
        }
        override fun onServiceLost(s: NsdServiceInfo) {
            if (s.serviceName == wanted) { current.set(null); onChange() }
        }
    }
    fun start() = nsd.discoverServices(NSD_TYPE, NsdManager.PROTOCOL_DNS_SD, discovery)
    fun stop() { runCatching { nsd.stopServiceDiscovery(discovery) }; current.set(null) }
}

/**
 * Surveillance de la connectivité : réseau par défaut différent, perte, changement de
 * transport (Wi-Fi ↔ cellulaire) et, côté tablette, changement d'adresses.
 */
class NetworkWatcher(
    context: Context,
    /** true côté tablette (suivre les changements de préfixe IPv6), false côté téléphone. */
    private val addressChanges: Boolean = true,
    private val onChange: (reason: String, lp: LinkProperties?) -> Unit,
) {
    private val cm = context.getSystemService(ConnectivityManager::class.java)
    private var lastNetwork: Network? = null
    private var lastTransport: String? = null

    private val cb = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(n: Network) {
            if (n != lastNetwork) { lastNetwork = n; onChange("nouveau réseau par défaut", cm.getLinkProperties(n)) }
        }
        override fun onLost(n: Network) {
            if (n == lastNetwork) { lastNetwork = null; onChange("réseau perdu", null) }
        }
        override fun onCapabilitiesChanged(n: Network, caps: NetworkCapabilities) {
            val t = when {
                caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
                caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellulaire"
                caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
                caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN) -> "vpn"
                else -> "autre"
            }
            if (t != lastTransport) { lastTransport = t; onChange("transport : $t", cm.getLinkProperties(n)) }
        }
        override fun onLinkPropertiesChanged(n: Network, lp: LinkProperties) { if (addressChanges) onChange("adresses modifiées", lp) }
    }
    fun start() = cm.registerDefaultNetworkCallback(cb)
    fun stop() = runCatching { cm.unregisterNetworkCallback(cb) }
}

object Ipv6Endpoints {
    /**
     * Adresses IPv6 globales STABLES de la tablette (on écarte les adresses temporaires de
     * confidentialité RFC 8981, dépréciées, lien-local et ULA), au format de l'EndpointBook.
     */
    fun stableGlobal(lp: LinkProperties?, port: Int): List<String> =
        lp?.linkAddresses.orEmpty()
            .filter { la ->
                val a = la.address
                a is Inet6Address && !a.isLinkLocalAddress && !a.isSiteLocalAddress &&
                    (a.address[0].toInt() and 0xFE) != 0xFC &&
                    (la.flags and OsConstants.IFA_F_TEMPORARY) == 0 &&
                    (la.flags and OsConstants.IFA_F_DEPRECATED) == 0
            }
            .map { EndpointBook.formatIp(it.address.hostAddress!!.substringBefore('%'), port) }
}
