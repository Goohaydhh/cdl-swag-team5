package fr.ecl.famchat.session.server

/** États de la tablette communiqués aux téléphones des parents (événements "sys.status"). */
object TabletStatus {
    const val KIND = "sys.status"
    const val APP_OPEN = "application démarrée sur la tablette"
    const val APP_CLOSED = "application non démarrée sur la tablette"
    const val SERVER_STOPPED = "serveur de la tablette arrêté"
    /** Affiché par le téléphone lui-même quand aucun chemin n'aboutit (la tablette ne peut plus rien envoyer). */
    const val UNREACHABLE = "tablette injoignable : éteinte, hors réseau ou application arrêtée de force"
}
