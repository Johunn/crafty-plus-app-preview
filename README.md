# CRAFTY+ — application communautaire de contrôle et de suivi

Aperçu de test : https://johunn.github.io/crafty-plus-app-preview/

Ce dépôt public contient le code source correspondant à la version publiée. Le projet est distribué sous GNU AGPL version 3 ; voir LICENSE et NOTICE.

## Fonctions

L’application permet de consulter et de régler les températures exposées par le CRAFTY+, d’activer la chauffe et de lire le niveau de batterie. Elle ajoute un historique local des cycles de connexion Bluetooth, une estimation de 0,25 g par cycle, des totaux, un graphique et un export CSV. Les données d’utilisation restent dans le stockage local du navigateur.

Le compteur suit les connexions Bluetooth, pas chaque chauffe individuelle ni la quantité réelle chargée dans la capsule. Le navigateur Android peut suspendre la PWA en arrière-plan ; la durée et les alertes batterie ne sont alors pas garanties.

## Installation Android

L’application est une PWA Web Bluetooth, pas un APK. Ouvre l’aperçu HTTPS dans Chrome sur Android, autorise Bluetooth et les services de localisation, puis utilise le menu Chrome pour l’installer ou l’ajouter à l’écran d’accueil. Le guide détaillé se trouve dans INSTALLATION-ANDROID.md.

## Développement

Node.js 20.19 ou plus récent est requis.

    npm ci
    npm run dev -- --host

Pour produire la version destinée à GitHub Pages :

    npm run build

La construction utilise le chemin du projet GitHub Pages.

## Origine et licence

La base est [Reactive Volcano App](https://github.com/firsttris/reactive-volcano-app), un projet communautaire indépendant. Cette application n’est ni le code officiel ni une copie exacte de l’application STORZ & BICKEL. Les avis d’origine sont dans NOTICE ; le texte de licence complet est dans LICENSE.

Le code source complet reste accessible dans ce dépôt, notamment depuis le lien « Code source et licence AGPLv3 » dans les réglages de l’application.
