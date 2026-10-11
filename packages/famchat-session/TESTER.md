# Tester : PC Windows = tablette, Galaxy A20 = téléphone du parent

Le PC fait tourner **exactement le même serveur de session** que la tablette Android
(`dist/famchat-pc.jar`), piloté au clavier. Le Galaxy A20 fait tourner une petite application
de test qui utilise la vraie couche session (`android-test/`).

Trois étapes, de la plus simple à la plus complète :

| Étape | Ce qui est testé | Durée |
|---|---|---|
| 1. PC ↔ PC | le protocole seul, sans Android | 5 min |
| 2. PC ↔ A20 en Wi-Fi | appairage par QR, messages, statut, coupures, reprise | 30 min |
| 3. PC ↔ A20 en 4G (IPv6) | accès distant, changement de réseau Wi-Fi ↔ 4G | 20 min, selon la box |

---

## Prérequis

**Sur le PC Windows**
- Java 17 ou plus : [Eclipse Temurin](https://adoptium.net/) (cocher « Add to PATH » à l'installation).
  Vérifier dans un terminal : `java -version`.
- Android Studio (pour l'étape 2), qui installe aussi `adb`
  (dans `%LOCALAPPDATA%\Android\Sdk\platform-tools`).

**Sur le Galaxy A20**
- **Android 10 minimum** (TLS 1.3). Vérifier : Paramètres › À propos du téléphone ›
  Informations sur le logiciel › Version d'Android. Le A20 est sorti sous Android 9 ; s'il n'a
  pas été mis à jour, faire la mise à jour (Paramètres › Mise à jour du logiciel).
- Options de développement : Paramètres › À propos du téléphone › Informations sur le logiciel ›
  taper 7 fois sur « Numéro de version ». Puis Paramètres › Options de développement ›
  activer « Débogage USB ».

---

## Étape 1 : PC ↔ PC (sans Android)

1. Dans `dist\`, double-cliquer sur **`tablette.bat`**. Au premier lancement, Windows demande
   l'autorisation du pare-feu pour Java : cocher **Réseaux privés** et valider.
2. Taper `invite`. L'invitation `famchat://pair?...` s'affiche (et est écrite dans
   `famchat-tablette\invitation.txt`).
3. Ouvrir un second terminal dans `dist\` et lancer :
   `telephone-pc.bat "famchat://pair?...."` (coller l'invitation entre guillemets).
4. Écrire un message côté téléphone ; côté tablette, taper `msg coucou`, puis `ferme`.

Résultat attendu côté téléphone : `● EN LIGNE`, `✓ reçu par la tablette (#1)`, le message
de l'enfant, puis `⚠ TABLETTE : application non démarrée sur la tablette`.

---

## Étape 2 : PC ↔ Galaxy A20 en Wi-Fi

### 2.1 Réseau

- Le PC et le A20 sur **le même Wi-Fi** (pas un réseau « invités » : il isole souvent les
  appareils entre eux).
- Windows : Paramètres › Réseau et Internet › Wi-Fi › votre réseau › profil **Privé**.
- Si l'autorisation du pare-feu a été refusée, l'ajouter en terminal **administrateur** :
  ```
  netsh advfirewall firewall add rule name="FamChat 8443" dir=in action=allow protocol=TCP localport=8443 profile=private
  ```

### 2.2 Créer l'application de test dans Android Studio

1. File › New › New Project › **Empty Views Activity**.
   Name `FamChatTest`, package `fr.ecl.famchat.test`, langage Kotlin, **Minimum SDK : API 29**.
2. Remplacer `app/src/main/java/fr/ecl/famchat/test/MainActivity.kt` par `android-test/MainActivity.kt`.
3. Remplacer `app/src/main/AndroidManifest.xml` par `android-test/AndroidManifest.xml`.
4. Dans `app/build.gradle.kts`, ajouter dans le bloc `android { … }` (chemin absolu, avec des `/`) :
   ```kotlin
   sourceSets["main"].java.srcDirs(
       "src/main/java",
       "C:/chemin/vers/famchat-session/core/src",
       "C:/chemin/vers/famchat-session/android/src",
   )
   ```
   La dépendance `androidx.core:core-ktx` est déjà présente dans le modèle de projet.
5. Brancher le A20 en USB, accepter « Autoriser le débogage USB », puis **Run ▶**.

> Le code Android n'a pas pu être compilé dans mon environnement : si Android Studio signale
> une erreur, copiez-la-moi, je corrige.

### 2.3 Appairer

1. Sur le PC (`tablette.bat`), taper `invite`.
2. Deux façons de transmettre l'invitation au A20 :
   - **par USB** : copier-coller la ligne `adb shell "am start …"` affichée par la tablette
     (depuis le dossier `platform-tools`, ou avec `adb` dans le PATH) ;
   - **par QR code** : `py -m pip install qrcode[pil]` puis
     `py -m qrcode "famchat://pair?..." > invitation.png`, ouvrir l'image et la scanner avec
     l'appareil photo Samsung : il propose d'ouvrir le lien dans FamChat test.
   - à défaut : coller l'invitation dans le champ de l'application et appuyer sur Envoyer.
3. L'application affiche `Appairé (ADMIN)` puis `● En ligne via ipv4`.

### 2.4 Scénarios à dérouler

| # | Action | Résultat attendu sur le A20 |
|---|---|---|
| 1 | Écrire un message sur le A20 | `✓ reçu par la tablette (#n)` ; la ligne apparaît sur le PC |
| 2 | PC : `msg à table !` | le message arrive en direct |
| 3 | PC : `ferme` | `⚠ TABLETTE : application non démarrée sur la tablette` |
| 4 | A20 : bouton « Simuler un changement de réseau » | bref `… Connexion`, puis `● En ligne`, sans rien perdre |
| 5 | A20 : mode avion ; PC : `msg 1`, `msg 2` ; écrire un message sur le A20 ; couper le mode avion | `○ Hors ligne` pendant la coupure ; au retour, `msg 1` et `msg 2` arrivent, et le message du A20 part (`✓ reçu`) une seule fois |
| 6 | Fermer l'application sur le A20 ; PC : `msg pendant ta fermeture`, `ouvre` ; rouvrir l'application | le message et le statut sont rattrapés à l'ouverture |
| 7 | PC : `quitter`, puis relancer `tablette.bat` | `⚠ serveur de la tablette arrêté`, `○ Hors ligne`, puis reconnexion automatique (session reprise) |
| 8 | PC : `appareils`, puis `revoque <id du A20>` | `■ ERREUR FATALE … réappairage nécessaire`, plus de tentative de connexion |

Sur le PC, `sessions` montre à tout moment le téléphone connecté et le chemin utilisé.

---

## Étape 3 (optionnelle) : le A20 en 4G, via IPv6

Le A20 en 4G est derrière le CGNAT de l'opérateur (RFC 6598) : en IPv4, il ne peut pas
joindre le PC. En IPv6, c'est possible si la box laisse entrer la connexion.

1. Sur le PC, `ipconfig` : noter une **adresse IPv6** commençant par `2` (ex. `2a01:…`). La
   tablette PC l'ajoute d'elle-même aux invitations (ligne « Adresses vues par le téléphone »).
2. Box : dans le pare-feu IPv6, autoriser en entrée le **TCP 8443** vers cette adresse
   (Freebox, Livebox, SFR Box et Bbox ont chacune ce réglage, sous des noms différents).
3. Windows : étendre la règle du pare-feu à tous les profils (`profile=any` dans la commande `netsh`).
4. **Refaire l'appairage** (`invite`) pour que le A20 connaisse l'adresse IPv6.
5. Couper le Wi-Fi du A20 : il doit afficher `● En ligne via ipv6`. Le réactiver : retour sur `ipv4`.

Windows change régulièrement ses adresses IPv6 « temporaires ». Pour un test stable :
`netsh interface ipv6 set privacy state=disabled` (terminal administrateur), puis redémarrer.

---

## Dépannage

| Symptôme | Cause probable | Solution |
|---|---|---|
| « tablette injoignable » à l'appairage | pare-feu, profil réseau « Public », Wi-Fi invités | §2.1 |
| « appairage uniquement depuis le réseau local » | le A20 passe par un VPN ou la 4G | couper le VPN, rester en Wi-Fi |
| « jeton inconnu ou déjà utilisé » / « invitation expirée » | invitation à usage unique, valable 10 min | refaire `invite` |
| Échec TLS après avoir supprimé `famchat-tablette\` | nouveau certificat, l'ancienne empreinte ne correspond plus | effacer les données de l'application sur le A20 et réappairer |
| L'application ne s'installe pas | Android 9 sur le A20 | mettre le téléphone à jour (Android 10 minimum) |
| Les accents s'affichent mal dans le terminal | page de code de la console | les `.bat` font déjà `chcp 65001` ; utiliser Windows Terminal |
