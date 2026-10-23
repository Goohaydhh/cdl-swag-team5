# Installer SWAG sur une nouvelle tablette

Ce guide se suit de bout en bout sans connaissance technique préalable : il suffit de taper les
commandes telles qu'elles sont écrites, dans l'ordre, et de vérifier à chaque fois ce qui
s'affiche.

Comptez deux heures la première fois, en deux temps : une demi-heure sur la tablette actuelle
pour préparer les fichiers, puis une heure et demie sur la nouvelle.

La tablette fait tourner **tout le système** : l'application des enfants, mais aussi le serveur
qui garde les messages et les statuts. C'est pour ça qu'il y a plusieurs choses à installer. Le
téléphone des parents se contente ensuite de s'y connecter.

---

## Les cinq fichiers dont vous aurez besoin

| Fichier | Ce que c'est | D'où il vient |
| --- | --- | --- |
| `swag.tgz` | Le serveur et tous ses composants | Vous le fabriquez — partie A |
| `swag-db.sql` | La structure de la base de données | Vous le fabriquez — partie A |
| `swag-fcm.json` | La clé qui autorise l'envoi des notifications | Déjà sur la tablette actuelle — partie A |
| `start-swag.sh` | Le script qui démarre tout | Déjà sur la tablette actuelle — partie A, ou GitLab, dossier `scripts/termux/` |
| `swag-tablette.apk` | L'application des enfants | GitLab, dossier `apk/` |

Quatre des cinq se fabriquent ou se récupèrent sur la tablette qui fonctionne aujourd'hui.
L'application elle-même se télécharge depuis le dépôt GitLab du projet :

> **gitlab.ec-lyon.fr/vkakubal/cdl-swag-team5** → branche `main` → dossier `apk/` →
> fichier `swag-tablette.apk`

Ouvrez le fichier dans GitLab, puis utilisez le bouton de téléchargement — la flèche vers le bas,
en haut à droite de la zone du fichier. Si vous pouvez le télécharger directement depuis le
navigateur de la **nouvelle** tablette, faites-le : cela vous épargne un transfert.

**Deux de ces fichiers contiennent des clés de sécurité** : `swag.tgz` et `swag-fcm.json`. Ils ne
doivent jamais être mis en ligne — ni sur un service de transfert, ni en pièce jointe d'un
e-mail. Une clé USB, et rien d'autre.

Il vous faut donc : la tablette actuelle, la nouvelle tablette, une clé USB (ou un ordinateur
pour faire le transfert), et les deux tablettes connectées au Wi-Fi.

---

# Partie A — Préparer les fichiers, sur la tablette actuelle

Tout se passe dans **Termux**, l'application à fond noir que vous utilisez déjà pour redémarrer
le serveur.

## A1 — Vérifier que le serveur tourne

Ouvrez Termux et tapez :

```
bash ~/start-swag.sh
```

Attendez une quinzaine de secondes. Vous devez lire :

```
{"status":"ok","db":"ok","redis":"ok","time":"..."}
```

C'est nécessaire pour la suite : la base doit être démarrée pour qu'on puisse en exporter la
structure. Si vous ne voyez pas cette ligne, arrêtez-vous ici et prévenez l'équipe.

## A2 — Exporter la structure de la base

```
pg_dump -d swag --schema-only --no-owner --no-privileges -f ~/swag-db.sql
```

Puis, pour vérifier :

```
ls -lh ~/swag-db.sql
```

Vous devez voir le nom du fichier avec une taille de quelques dizaines de kilooctets — par
exemple `25K`. Si la taille affichée est `0`, l'export a échoué : reprenez l'étape A1.

Ce fichier ne contient **que la structure** des tables, pas leur contenu. Vos messages, vos
dessins et vos statuts restent sur cette tablette : la nouvelle démarrera sur une famille vierge.

## A3 — Fabriquer l'archive du serveur

```
cd ~ && tar -czf swag.tgz swag
```

Cette commande prend plusieurs minutes et n'affiche rien pendant ce temps. C'est normal :
attendez que le `$` revienne.

```
ls -lh ~/swag.tgz
```

Vous devez voir une taille de plusieurs centaines de mégaoctets, par exemple `480M`.

Vérifiez maintenant que l'archive contient bien les réglages, sans quoi la nouvelle tablette
démarrerait sans configuration :

```
tar -tzf ~/swag.tgz | grep -E "apps/api/(\.env|keys/)"
```

Deux lignes au moins doivent s'afficher, contenant `.env` et `keys`. Si rien ne s'affiche,
prévenez l'équipe avant d'aller plus loin : l'archive serait inutilisable.

## A4 — Rassembler les quatre fichiers

```
cp ~/swag-db.sql ~/swag.tgz ~/swag-fcm.json ~/start-swag.sh /sdcard/Download/
```

Aucun message ne s'affiche si tout va bien — sous Termux, le silence veut dire que ça a marché.

```
ls -lh /sdcard/Download/swag* /sdcard/Download/start-swag.sh
```

Les quatre noms doivent apparaître avec leur taille.

## A5 — Transférer vers la nouvelle tablette

Copiez ces quatre fichiers, plus `swag-tablette.apk` téléchargé depuis GitLab, dans le dossier
**Téléchargements** de la **nouvelle** tablette. Par clé USB, ou en passant par un ordinateur :
peu importe, pourvu que les cinq se retrouvent dans Téléchargements, et pas dans un sous-dossier.

Pour vérifier sur la nouvelle tablette : application **Fichiers** → **Stockage interne** →
**Download**. Les cinq noms doivent y être.

Le reste du guide se passe sur la **nouvelle** tablette.

---

# Partie B — Installer, sur la nouvelle tablette

## B1 — Installer Termux

Termux est l'application qui ouvre une fenêtre où l'on tape des commandes. C'est elle qui fera
tourner le serveur.

**Ne l'installez pas depuis le Play Store** : la version qui s'y trouve est abandonnée depuis des
années et ne fonctionnera pas. Il faut la prendre sur F-Droid.

1. Sur la nouvelle tablette, ouvrez le navigateur et allez sur **f-droid.org**.
2. Téléchargez F-Droid et installez-le. Android demandera d'autoriser l'installation depuis le
   navigateur : acceptez.
3. Ouvrez F-Droid, cherchez **Termux**, installez-le.

Ouvrez Termux. Vous voyez un fond noir avec une ligne qui se termine par `$`. C'est là que tout
se tape.

Un conseil : le clavier à l'écran rend la saisie pénible. Si vous avez un clavier Bluetooth,
c'est le moment de le brancher.

## B2 — Autoriser Termux à lire vos fichiers

```
termux-setup-storage
```

Android affiche une demande d'autorisation : acceptez. Sans cela, Termux ne pourra pas aller
chercher les fichiers dans Téléchargements.

## B3 — Installer les logiciels nécessaires

Trois programmes : la base de données, le cache mémoire, et Node qui fait tourner le serveur.
Tapez les lignes **une par une**, en attendant que chacune se termine.

```
pkg update
```

Répondez `y` si une question apparaît.

```
pkg install -y postgresql redis nodejs
```

Cette commande télécharge plusieurs centaines de mégaoctets : comptez dix à quinze minutes.
Laissez la tablette allumée et l'écran actif.

```
node -v
```

Vous devez voir un numéro de version commençant par `v`. Si vous lisez `command not found`,
l'installation a échoué : relancez la commande `pkg install`.

## B4 — Installer le serveur

```
cd ~
cp ~/storage/downloads/swag.tgz ~/storage/downloads/swag-db.sql ~/storage/downloads/swag-fcm.json ~/storage/downloads/start-swag.sh ~/
```

```
tar -xzf swag.tgz
```

Plusieurs minutes, sans aucun affichage. Attendez le retour du `$`.

```
ls swag
```

Vous devez voir une liste contenant `apps`, `packages` et `node_modules`. Si elle est vide ou si
une erreur apparaît, la décompression a échoué : recommencez la commande `tar`.

```
chmod +x ~/start-swag.sh
```

## B5 — Préparer la base de données

C'est l'étape la plus longue. Les commandes doivent être tapées dans l'ordre exact.

```
initdb $PREFIX/var/lib/postgresql
```

Beaucoup de texte défile. À la fin vous devez lire `Success.` ou une ligne proposant de démarrer
le serveur. Si vous lisez `directory is not empty`, la base existe déjà : passez à la commande
suivante, ce n'est pas une erreur.

```
pg_ctl -D $PREFIX/var/lib/postgresql -l ~/pg.log start
```

Attendez cinq secondes, puis :

```
createdb swag
```

```
psql -d swag -c "CREATE USER swag WITH PASSWORD 'swag' SUPERUSER;"
```

Vous devez lire `CREATE ROLE`. Si vous lisez `role "swag" already exists`, continuez.

```
psql -d swag -f ~/swag-db.sql
```

Du texte défile — des `CREATE TABLE`, des `CREATE INDEX`. C'est bon signe.

```
psql -d swag -c "\dt"
```

Vous devez voir une liste d'une quinzaine de tables : `families`, `users`, `messages`,
`devices`… Si la liste est vide, reprenez la commande précédente.

## B6 — Démarrer le serveur

```
bash ~/start-swag.sh
```

Le script démarre la base, le cache, puis le serveur, et attend quinze secondes avant de
vérifier que tout répond. À la fin vous devez lire exactement ceci :

```
{"status":"ok","db":"ok","redis":"ok","time":"..."}
```

**Si vous lisez ça, le serveur fonctionne.** C'est le moment le plus important du guide. Sinon,
allez voir « Si ça ne marche pas » avant de continuer.

## B7 — Empêcher Android d'éteindre le serveur

Android coupe les applications qu'il juge inactives. Sans ces deux réglages, le serveur
s'arrêtera tout seul au bout de quelques heures.

Dans les **paramètres de la tablette** : Applications → Termux → Batterie → **Aucune
restriction**. Le libellé exact varie : « Non optimisé », « Autoriser en arrière-plan ».

Puis **tirez la barre de notifications vers le bas**. Vous voyez une notification Termux :
touchez **ACQUIRE WAKELOCK** dessus. Elle empêche la mise en veille du serveur.

## B8 — Installer l'application des enfants

Ouvrez **Fichiers** → **Stockage interne** → **Download**, et touchez `swag-tablette.apk`.
Android demandera d'autoriser l'installation depuis cette source : acceptez, puis installez.

Ouvrez SWAG. L'écran demande un code d'association : c'est normal, il viendra du téléphone
(étape B10).

## B9 — Installer la voix française

Sans cette étape, le bouton qui lit les messages à voix haute restera muet.

Paramètres de la tablette → Accessibilité → Synthèse vocale. Sur certaines tablettes le chemin
est Général → Langue et saisie → Synthèse vocale.

1. Choisissez **Google Text-to-speech** comme moteur préféré. Même s'il est seul dans la liste,
   touchez-le pour le sélectionner explicitement.
2. Touchez l'**engrenage** à côté, puis **Installer les données vocales**, et téléchargez le
   **français**.
3. Revenez en arrière et touchez **Écouter un exemple**. Vous devez entendre une voix.

Si vous n'entendez rien ici, le bouton de lecture ne marchera pas non plus dans l'application :
c'est le moteur Android qui est en cause, pas SWAG.

## B10 — Connecter le téléphone des parents

Le téléphone doit savoir où joindre la nouvelle tablette.

**Trouvez son adresse** : paramètres de la tablette → À propos de la tablette → État → **Adresse
IP**. C'est une suite de quatre nombres, par exemple `192.168.1.24`.

Sur le **téléphone**, dans SWAG, sur l'écran de connexion, ouvrez **Serveur** et tapez l'adresse
sous cette forme, avec vos nombres à vous :

```
http://192.168.1.24:3100
```

Fermez puis rouvrez l'application du téléphone pour qu'elle prenne l'adresse en compte.

Ensuite, dans l'app du téléphone : **Famille → Associer une tablette**. Un code s'affiche.
Tapez-le sur la tablette, puis validez l'association depuis le téléphone.

Le téléphone et la tablette doivent être sur **le même Wi-Fi**. Si l'adresse de la tablette
change — ce qui arrive quand la box redémarre — il faudra la retaper dans Serveur.

---

## Au quotidien

Le serveur redémarre tout seul tant que la tablette reste allumée. Après un **redémarrage de la
tablette**, en revanche, il faut le relancer à la main : ouvrez Termux et tapez

```
bash ~/start-swag.sh
```

puis attendez le `{"status":"ok"...}`. C'est la seule commande à retenir.

---

## Si ça ne marche pas

| Ce que vous voyez | Ce que ça veut dire | Quoi faire |
| --- | --- | --- |
| `ls -lh ~/swag-db.sql` affiche une taille de `0` (étape A2) | La base n'était pas démarrée | Reprendre l'étape A1, puis A2 |
| Rien ne s'affiche après le `tar -tzf` de l'étape A3 | L'archive ne contient pas les réglages | Ne pas continuer, prévenir l'équipe |
| `command not found` sur `node`, `psql` ou `redis-server` | Un logiciel n'a pas été installé | Reprendre l'étape B3 |
| `directory is not empty` sur `initdb` | La base existe déjà | Passer à la commande suivante, ce n'est pas une erreur |
| `could not connect to server` après `start-swag.sh` | La base de données ne démarre pas | `pg_ctl -D $PREFIX/var/lib/postgresql -l ~/pg.log start`, attendre 5 secondes, relancer le script |
| `Illegal instruction` ou `UVWASI_EACCES` | Un composant de sécurité ne tourne pas sur ce processeur | Taper `cd ~/swag && bash scripts/termux/fix-argon2.sh`, puis reprendre l'étape B6 |
| Le `{"status":"ok"}` ne vient jamais | Le serveur a refusé de démarrer | Taper `tail -n 30 ~/api.log` et envoyer le résultat à l'équipe |
| L'app de la tablette reste sur « Chargement » | Le serveur est arrêté | Ouvrir Termux, relancer `bash ~/start-swag.sh` |
| Le téléphone dit « Pas de connexion au serveur SWAG » | Mauvaise adresse, ou pas le même Wi-Fi | Vérifier l'adresse IP (étape B10) et le réseau des deux appareils |
| Le serveur s'arrête tout seul après quelques heures | Android a coupé Termux | Refaire l'étape B7, les deux réglages |

Si vous êtes bloquée, notez **le numéro de l'étape** et **le message affiché mot pour mot**, et
transmettez-les à l'équipe : avec ces deux informations, la cause se trouve généralement en
quelques minutes.
