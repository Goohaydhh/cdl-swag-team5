# FamChat — module de session (couche 5)

Gestion de la session entre le téléphone d'un parent et la tablette de la maison,
**quel que soit le réseau traversé** (Wi-Fi de la maison, IPv6 via 4G/5G, Tor en secours),
sans serveur hébergé, sans compte, sans adresse e-mail.

**Usage à la demande** : sur le téléphone, la session s'ouvre quand le parent ouvre
l'application et se ferme quand il la quitte. Rien ne tourne en arrière-plan côté téléphone.

```
core/      module Kotlin pur (aucune dépendance) — compilé et testé
  wire/        codec TLV binaire + messages du protocole
  crypto/      ECDSA P-256, transcripts signés, TLS 1.3 avec épinglage
  transport/   liens TLS, sélection du chemin, carnet d'extrémités
  store/       persistance (mémoire, fichiers append-only), export XML
  client/      boucle de session du téléphone + appairage
  server/      serveur de session de la tablette, politique de rôles, invitation QR
core/test/  21 scénarios d'intégration (coupures, changement de réseau, lien mort, redémarrages, attaques)
android/   adaptateurs Android (Keystore, mDNS, NetworkCallback, service tablette) — NON compilés ici
pc/        le PC joue la tablette ou le téléphone (console), même cœur que sur Android
dist/      famchat-pc.jar prêt à l'emploi + tablette.bat / telephone-pc.bat (Windows)
android-test/  application de test du téléphone (une activité)
```

**Pour tester avec un PC Windows et un téléphone Android : voir [TESTER.md](TESTER.md).**

---

## 1. Principe : la session est découplée du transport

| Notion | Porte quoi | Survit à |
|---|---|---|
| **Identité** | clé EC du téléphone (Keystore) + empreinte du certificat de la tablette | tout |
| **Session** | `sessionId` attribué par la tablette | coupure, changement de réseau, fermeture de l'application |
| **Point de synchronisation** | `lastSeq` : dernier événement appliqué localement | idem |
| **Dialogue** | file d'attente sortante persistante + idempotence par `clientMsgId` | idem |
| **Lien de transport** | une socket TLS sur un chemin (lan, ipv6, tor…) | **rien** : il est jetable |

Correspondance avec la couche 5 OSI (ISO 8327) :

- **Établissement / libération** : `HELLO → CHALLENGE → AUTH → AUTH_OK` … `BYE`
- **Points de synchronisation** : numéro `seq` attribué par la tablette
- **Resynchronisation** : `HELLO(lastSeq)` → la tablette renvoie tout `seq > lastSeq` puis `SYNC_DONE`
- **Gestion du dialogue** : `SUBMIT(clientMsgId)` → `SUBMIT_ACK(seq)` ; un rejeu renvoie le même `seq`

## 2. La boucle de session du téléphone (`SessionClient`)

Un seul fil exécute une boucle linéaire, sans machine d'états explicite :

```
tant que l'application est ouverte :
    CONNECTING  essayer les chemins par priorité, garder le premier qui établit TCP + TLS épinglé
                HELLO → CHALLENGE → AUTH (signature) → AUTH_OK
                recevoir les événements manqués … SYNC_DONE
    ONLINE      envoyer la file d'attente ; recevoir ; répondre PONG aux PING de la tablette
                … jusqu'à : lien perdu, délai de lecture dépassé, BYE ou changement de réseau
    OFFLINE     attendre 0 s, 1 s, 2 s, 5 s, 10 s puis 30 s (un changement de réseau réveille aussitôt)
erreur fatale (révocation, signature refusée) → CLOSED, sans nouvelle tentative
```

**Aucune horloge sur le téléphone.** La seule horloge du système est sur la tablette : elle
envoie un PING toutes les 20 s à chaque téléphone connecté. Côté téléphone, un délai de
lecture de 50 s (plus de deux PING manqués) suffit à détecter un lien mort, y compris le
cas où rien n'est signalé (NAT expiré, Wi-Fi quitté brutalement). Le PING maintient aussi
ouvertes les tables NAT/CGNAT.

**Changement de réseau** (Wi-Fi ↔ 4G) : Android le signale, le lien courant est fermé et la
boucle repart immédiatement sur le meilleur chemin. Coût : une reconnexion (quelques
centaines de ms), sans perte ni doublon grâce à `lastSeq` et à l'idempotence.

## 3. Sélection de chemin

`EndpointBook` construit les candidats à chaque tentative ; ils sont essayés **dans l'ordre** :

| Priorité | Chemin | Source de l'adresse |
|---|---|---|
| 0 | `lan` | découverte mDNS/DNS-SD — seulement si la tablette est visible sur le Wi-Fi |
| 1 | `ipv6` | adresse globale stable de la tablette (QR, puis mises à jour en bande) |
| 2 | `ipv4` / `dns` | redirection de port, si la box n'est pas derrière un CGNAT |
| 3 | `tor` | service onion `.onion` via le SOCKS du démon Tor embarqué |

L'épinglage TLS rend la vérification indépendante du chemin : la même empreinte vaut sur
le LAN, en IPv6 et via Tor. Quand le préfixe IPv6 change, la tablette publie ses nouvelles
extrémités (événement `sys.endpoints`) et le téléphone met son carnet à jour.

## 4. Protocole (trames TLV)

Trame : `[longueur u32][type u8][nb champs u16]` puis `[tag u8][longueur u32][valeur]`.
Les tags inconnus sont ignorés (compatibilité ascendante). Taille maximale : 1 Mio.

| Type | Message | Sens | Contenu |
|---|---|---|---|
| 1 | HELLO | T→Tab | deviceId, version, sessionId précédent, lastSeq |
| 2 | CHALLENGE | Tab→T | nonce 32 octets |
| 3 | AUTH | T→Tab | signature ECDSA du transcript |
| 4 | AUTH_OK | Tab→T | sessionId, headSeq, reprise ?, rôle |
| 5 | SYNC_DONE | Tab→T | headSeq |
| 10 / 11 | PAIR_REQ / PAIR_OK | T↔Tab | jeton, clé publique, preuve de possession / rôle |
| 20 / 21 | SUBMIT / SUBMIT_ACK | T↔Tab | clientMsgId, type, charge / seq |
| 22 | EVENT | Tab→T | seq, id, origine, type, charge, horodatage |
| 30 / 31 | PING / PONG | Tab→T / T→Tab | horodatage |
| 40 / 41 | BYE / ERROR | ↔ | motif / code, détail, référence |

Transcript d'authentification signé :
`"FAMCHAT-AUTH-v1" ‖ nonce ‖ deviceId ‖ empreinte du certificat de la tablette`
(anti-rejeu par le nonce, liaison au canal par l'empreinte).

## 5. Appairage

1. La tablette affiche un QR : `famchat://pair?v=1&t=<jeton>&r=ADMIN&x=<expiration>&fp=<sha256>&f=<famille>&e=lan&e=ip:[…]:8443&e=ip:192.168.1.20:8443`
2. Le téléphone (sur le Wi-Fi de la maison) se connecte en TLS **épinglé** sur `fp`.
3. Il envoie `PAIR_REQ` : jeton + clé publique Keystore + signature de
   `"FAMCHAT-PAIR-v1" ‖ jeton ‖ deviceId ‖ fp` (preuve de possession).
4. La tablette vérifie : adresse du pair locale (RFC 1918, lien-local, ULA — **pas**
   100.64/10, RFC 6598), jeton existant, non expiré, **à usage unique**, preuve valide.

## 6. Sécurité conservée

| Menace | Parade |
|---|---|
| Faux serveur (DNS, Wi-Fi piégé) | TLS 1.3 + épinglage de l'empreinte du QR |
| Usurpation d'un téléphone | défi-réponse ECDSA, clé non exportable du Keystore |
| Rejeu d'une authentification | nonce aléatoire par connexion |
| Appairage à distance | jeton à usage unique, 2 min, adresse locale exigée |
| Téléphone perdu ou volé | révocation depuis la tablette, effet immédiat |
| Enfant ou parent qui dépasse ses droits | politique de rôles côté tablette |
| Trames malformées ou géantes | décodage strict, taille maximale 1 Mio |

## 7. Persistance

- **Journal append-only** (une trame TLV par événement, `fsync`) : un enregistrement tronqué
  par une coupure de courant est retiré au rechargement ; `lastSeq` se déduit du journal.
- **Petits états** (session, file d'attente, appareils) : réécriture atomique (`.tmp` + `rename`).
- **XML** : `XmlExport.events(...)` produit une vue lisible (sauvegarde, annexe du rapport).

## 8. Tests (`./build.sh`)

| Domaine | Scénario vérifié |
|---|---|
| Protocole | aller-retour de tous les messages ; trames malformées ou géantes rejetées ; classification RFC 1918 / RFC 6598 / ULA |
| Appairage | succès, jeton à usage unique, invitation expirée, faux certificat refusé |
| Session | temps réel à 3 participants ; coupure avec messages écrits hors ligne (livrés **une seule fois**, session reprise) |
| Mobilité | retour à la maison sous trafic continu (IPv6 → LAN sans trou ni doublon) ; lien « trou noir » détecté par l'absence de PING ; reconnexion immédiate sur changement de réseau |
| Persistance | redémarrage du téléphone et de la tablette ; journal tronqué réparé ; export XML |
| État de la tablette | statut « application non démarrée » reçu en direct et rattrapé après une coupure ; non falsifiable par l'enfant |
| Sécurité | appareil révoqué ; usurpation ; politique de rôles ; idempotence d'un SUBMIT rejoué |

Les chemins sont simulés par `TcpRelay` (FORWARD, DOWN, BLACKHOLE).

## 9. Côté Android (dossier `android/`)

| Fichier | Rôle |
|---|---|
| `Identity.kt` | clé du téléphone et certificat TLS de la tablette dans l'**Android Keystore** |
| `Network.kt` | mDNS (`_famchat._tcp`), `NetworkCallback`, adresses IPv6 globales stables |
| `PhoneSession.kt` | appairage depuis le QR ; `open()`/`close()` à appeler dans `onStart`/`onStop` |
| `TabletServerService.kt` | serveur de la tablette, relance au démarrage, statut ouvert/fermé |

**Ces fichiers n'ont pas pu être compilés ici** (pas de SDK Android dans l'environnement de
génération) : à compiler dans Android Studio, voir `gradle-integration.md`.

**Cycle de vie du serveur de la tablette**

| Événement | Ce qui se passe | Ce que reçoit le parent |
|---|---|---|
| Premier lancement après l'installation | le service démarre | « application démarrée sur la tablette » |
| L'enfant ferme l'application (retour, ou balayage des applications récentes) | le serveur **continue** (`stopWithTask="false"`) | « application non démarrée sur la tablette » |
| L'enfant la rouvre | — | « application démarrée sur la tablette » |
| Redémarrage de la tablette, mise à jour de l'application | relance automatique (`BootReceiver`) | « application non démarrée sur la tablette » |
| Arrêt propre du service | dernier message avant fermeture | « serveur de la tablette arrêté » |
| Tablette éteinte, hors réseau, « Forcer l'arrêt » | plus rien ne peut partir de la tablette | le téléphone affiche lui-même « tablette injoignable » |

Ces états sont des événements du journal (`sys.status`) : un parent hors ligne au moment de
la fermeture les reçoit dès sa prochaine connexion. Seul le serveur peut les émettre
(rôle SYSTEM) : l'interface de l'enfant ne peut pas en forger.

Limites d'Android à connaître :
- **aucun code ne s'exécute à l'installation** : le serveur démarre au premier lancement
  (qui a lieu de toute façon pour afficher le QR d'appairage), puis automatiquement ;
- **« Forcer l'arrêt »** dans les paramètres tue tout et bloque la relance jusqu'au prochain
  lancement manuel. Pour l'empêcher : épinglage d'écran, ou mode kiosque (Device Owner) ;
- le téléphone n'ayant pas de service en arrière-plan, l'alerte s'affiche **à l'ouverture**
  de l'application par le parent, pas en notification instantanée.

À vérifier en premier sur la Samsung : le serveur TLS avec une clé de l'Android Keystore
(`TabletTlsIdentity.serverContext()`). Repli possible : clé logicielle dans un PKCS12 du
stockage privé de l'application.

## 10. Tor (chemin de secours)

Le module passe déjà par un proxy SOCKS (`EndpointBook(torSocks = …)`). Reste à embarquer
le démon (`tor-android` du Guardian Project, ou Arti) : côté tablette
`HiddenServicePort 8443 127.0.0.1:8443`, puis `TabletServerService.onionHost = "<adresse>.onion"`.
