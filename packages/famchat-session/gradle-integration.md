# Intégration dans Android Studio

Structure conseillée du projet :

```
FamChat/
├── settings.gradle.kts         include(":session-core", ":app")
├── session-core/               ← copier ici core/src (module Kotlin/JVM pur, sans Android)
│   └── build.gradle.kts
└── app/                        ← application Android
    ├── build.gradle.kts
    └── src/main/
        ├── AndroidManifest.xml ← fusionner android/AndroidManifest.xml
        └── java/fr/ecl/famchat/android/  ← copier android/src/...
```

## session-core/build.gradle.kts

```kotlin
plugins {
    id("java-library")
    id("org.jetbrains.kotlin.jvm")
}
java { toolchain { languageVersion.set(JavaLanguageVersion.of(17)) } }
kotlin { jvmToolchain(17) }
sourceSets {
    main { kotlin.srcDir("src") }       // ou déplacer les sources dans src/main/kotlin
}
```

Le module n'a **aucune dépendance** : uniquement la bibliothèque standard Kotlin et le JDK
(JCA pour ECDSA, JSSE pour TLS). Il tourne tel quel sur Android et sur un PC (tests).

## app/build.gradle.kts (extraits)

```kotlin
android {
    defaultConfig { minSdk = 29; targetSdk = 35 }      // 29 : TLS 1.3 natif
}
dependencies {
    implementation(project(":session-core"))
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("com.google.zxing:core:3.5.3")          // génération du QR (tablette)
    implementation("com.journeyapps:zxing-android-embedded:4.3.0") // scan du QR (téléphone)
}
```

## Utilisation depuis l'interface

```kotlin
// Tablette — écran de l'enfant : démarre le serveur et signale l'ouverture / la fermeture
override fun onCreate(b: Bundle?) { super.onCreate(b); TabletServerService.appVisible(this, true) }
override fun onDestroy() { if (isFinishing) TabletServerService.appVisible(this, false); super.onDestroy() }

// Tablette — écran administrateur : QR d'appairage
val invite = TabletServerService.instance!!.createInvite(Role.ADMIN)
afficherQr(invite.toUri())                      // ZXing BarcodeEncoder → Bitmap

// Tablette — l'enfant coche une tâche
TabletServerService.instance!!.server.submitLocal("mustdo.done", idTache.toByteArray())

// Téléphone — une fois, après scan du QR (hors thread UI)
PhonePairing.pairFromQr(this, texteQr, "Téléphone de Papa")

// Téléphone — la session vit avec l'écran
override fun onStart() { super.onStart(); if (!PhoneSession.open(this, monListener)) ouvrirEcranScan() }
override fun onStop()  { PhoneSession.close(); super.onStop() }

// Téléphone — envoyer un message
PhoneSession.client?.submit("chat.private", "J'arrive à 18 h".toByteArray())
```
