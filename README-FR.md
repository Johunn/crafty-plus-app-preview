# CRAFTY+ — commandes et suivi

## Origine du projet

Le code de l’application officielle STORZ & BICKEL n’a pas été trouvé dans un dépôt public. Le projet utilisé comme base est [Reactive Volcano App](https://github.com/firsttris/reactive-volcano-app), une application communautaire indépendante qui communique avec le CRAFTY+ en Bluetooth. Ce n’est ni le code ni une copie exacte de l’interface officielle.

## Commandes CRAFTY+ conservées

Cette base conserve un écran de contrôle Bluetooth pour la température actuelle et la température cible, le réglage de la température de base et de l’offset Boost, la commande de chauffe et l’état de batterie. Elle conserve aussi les réglages et informations exposés par le micrologiciel : luminosité LED, vibration, voyant de charge, arrêt automatique, Bluetooth permanent, localisation du CRAFTY+, heures d’utilisation, versions de micrologiciel, diagnostic et réinitialisation d’usine. L’unité peut s’afficher en °C ou en °F ; ce choix modifie l’affichage local, et les consignes sont toujours envoyées au CRAFTY+ en Celsius. Les fonctions indisponibles sur certains micrologiciels restent masquées.

Le CRAFTY+ propose ses niveaux Base, Booster et Superbooster. L’application communautaire règle la température de base et l’offset partagé des modes Boost ; le mode Superboost à 210 °C et le passage entre les modes restent commandés par le bouton du CRAFTY+. L’écran ne fournit pas de sélecteur séparé Base/Booster/Superbooster. Les ressources officielles (application Web, manuels, assistance et garantie) sont accessibles depuis les réglages ; les listes de plantes ne sont pas recopiées dans cette application.

## Suivi ajouté

- Chaque connexion Bluetooth GATT réussie du CRAFTY+ ajoute **1 connexion** et une estimation de **0,25 g**.
- Une connexion persistante n’ajoute rien de plus. Une déconnexion suivie d’une reconnexion forme un nouveau cycle, même si l’interruption est courte.
- L’application enregistre les heures de début et de fin ainsi que la durée de liaison Bluetooth. Tant que l’appareil est connecté et que l’application tourne, le dernier instant de liaison est sauvegardé chaque minute. Si Android ferme le navigateur sans transmettre la déconnexion, l’heure de fin est estimée à partir de ce dernier instant enregistré ; cette estimation est indiquée dans l’historique et le CSV.
- Après 6 heures entre la fin enregistrée ou estimée et la connexion suivante, une nouvelle période commence. L’historique précédent est conservé. Si le navigateur a été fermé ou suspendu, la coupure et la limite de 6 heures restent approximatives ; une PWA ne garantit pas une surveillance BLE continue.
- L’onglet **Suivi** reste accessible appareil déconnecté. Il affiche la période en cours, les totaux quotidiens et hebdomadaires, un graphique, les connexions récentes et un export CSV.

Ce compteur mesure des cycles de connexion/allumage, pas les chauffes individuelles ni la masse réellement chargée dans la capsule. L’historique de chauffe fourni par l’application de base reste séparé.

## Notification batterie

Une option des réglages demande une notification lorsque la batterie du CRAFTY+ passe à 20 % ou moins. Elle ne peut fonctionner que si le niveau de batterie est transmis par Bluetooth, si le navigateur autorise les notifications et si Android laisse l’application active assez longtemps pour recevoir la mise à jour. Ce n’est pas une surveillance garantie lorsque l’application est fermée.

## Installation et limites Android

Le projet est une PWA installable depuis Chrome sur Android, **pas un APK natif**. Web Bluetooth demande une origine sécurisée (HTTPS en général), l’autorisation Bluetooth du navigateur et les services de localisation activés selon les indications de STORZ & BICKEL pour Chrome Android. Les réglages d’appareil restent transmis directement par Bluetooth ; les données de suivi sont enregistrées dans IndexedDB sur le téléphone. L’effacement des données du navigateur peut supprimer cet historique ; l’export CSV permet d’en garder une copie.

## Lancer le projet

Node.js 20.19 ou plus récent est requis.

```text
npm ci
npm run dev -- --host
```

Pour produire les fichiers statiques à héberger à la racine d’un site HTTPS :

```text
npm run build:root
```

## Licence et attribution

La base est distribuée sous licence **GNU AGPL version 3**. Les fichiers `LICENSE` et `NOTICE` sont conservés. Cette adaptation n’est pas affiliée à STORZ & BICKEL.
