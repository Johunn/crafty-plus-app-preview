# Installer l’application CRAFTY+ sur Android

## Version PWA

La version de test reste disponible à l’adresse publique [https://johunn.github.io/crafty-plus-app-preview/](https://johunn.github.io/crafty-plus-app-preview/). Dans Chrome sur Android, ouvre ce lien et choisis **Installer l’application** dans le menu. Cette version conserve les contrôles Bluetooth disponibles, mais Android ne garantit pas le suivi BLE lorsque Chrome est fermé ou suspendu.

## Version Android avec suivi en arrière-plan

Après chaque publication du dépôt public, GitHub Actions construit un APK de test dans le workflow [Build CRAFTY+ Android APK](https://github.com/Johunn/crafty-plus-app-preview/actions/workflows/android.yml).

Si tu as déjà installé la version qui affiche un écran blanc, désinstalle-la avant d’installer le nouvel APK. Cette version corrige le chemin de démarrage de l’interface.

Pour les mises à jour, les APK de test générés par GitHub Actions peuvent avoir des certificats de signature différents. Si Android refuse d’installer le nouvel APK par-dessus l’ancien, ouvre d’abord l’ancienne application, attends que le suivi apparaisse, puis exporte le fichier JSON depuis **Réglages > Sauvegarde des données**. Vérifie que le fichier est bien enregistré et accessible. Désinstalle ensuite l’ancienne version, installe le nouvel APK et importe cette sauvegarde depuis les réglages. La désinstallation efface les données locales de l’application.

1. Ouvre le workflow, puis son exécution la plus récente terminée avec succès.
2. Télécharge l’artefact **crafty-plus-android-debug-apk**, décompresse-le et récupère `app-debug.apk`.
3. Ouvre l’APK sur le téléphone. Si Android le demande, autorise l’installation depuis la source utilisée pour le téléchargement.
4. Lance **CRAFTY+**, active le Bluetooth du téléphone et connecte le CRAFTY+ depuis l’écran d’accueil de l’application. Autorise l’accès Bluetooth. Le suivi natif démarre avec la connexion et affiche une notification persistante.
5. Tu peux ensuite verrouiller l’écran ou passer dans une autre application. Ne choisis pas **Arrêter le suivi** dans la notification si tu veux continuer à enregistrer les données.

Sur Android, l’autorisation importante pour la recherche est **Appareils à proximité** (ou **Appareils à proximité et Bluetooth**) dans les permissions de l’application. L’autorisation **Notifications** sert à afficher le suivi persistant et les alertes, pas à détecter le CRAFTY+. Si son nom n’est pas reconnu par la recherche, la nouvelle version affiche les autres appareils BLE trouvés pour permettre une sélection manuelle.

Tant que la notification persistante **Suivi actif** reste présente, tu n’as pas besoin d’ouvrir l’application à chaque session : le service écoute le CRAFTY+ et tente de se reconnecter si la liaison tombe puis que l’appareil redevient disponible.

Sur Samsung, règle aussi **Paramètres > Applications > CRAFTY+ > Batterie > Non restreinte** (les libellés peuvent varier selon One UI). Le service peut être arrêté si Android ou l’utilisateur force l’arrêt de l’application. Après un redémarrage du téléphone ou un arrêt forcé, relance l’application et reconnecte le CRAFTY+.

Le compteur natif s’appuie sur les températures reçues par Bluetooth : une session est validée après 3 minutes au-dessus de 170 °C. Une baisse sous le seuil durant 90 secondes clôt la session. Si aucun relevé de température n’arrive pendant plus de 12 secondes, le compteur clôt la session à la dernière mesure et attend une nouvelle période continue. La quantité reste une estimation de 0,25 g par session qualifiée. Elle ne mesure pas chaque inhalation ni la masse réelle chargée dans la capsule.

Dans les réglages, active **M’avertir si la batterie est faible** et autorise les notifications Android pour recevoir l’alerte à 20 % ou moins. Cette alerte n’est possible que si le CRAFTY+ transmet son niveau de batterie.

## Transférer l’historique de la PWA vers l’APK

Dans la PWA déjà installée, ouvre les réglages et utilise **Exporter** dans la section Sauvegarde des données. Dans l’APK, ouvre les réglages et choisis **Importer**, puis sélectionne le fichier JSON. L’import fusionne les historiques et conserve les données déjà présentes. Recharge l’application après l’import pour afficher les données restaurées.

Les sauvegardes restent des fichiers locaux sur le téléphone. Garde-en une copie si tu veux protéger ton historique.

## Limites connues

- L’application Android reprend l’interface web du projet et la relie au protocole BLE natif. Le code officiel de STORZ & BICKEL n’est pas utilisé.
- Le service peut maintenir la connexion et enregistrer les relevés pendant que l’interface n’est pas affichée, tant que le processus Android du service reste actif.
- Le suivi commence après une connexion lancée depuis l’application. Il ne démarre pas automatiquement après le redémarrage du téléphone.
- L’APK produit par le workflow est un APK debug non signé pour une distribution commerciale. Android peut signaler que l’application vient d’une source externe.
- La compilation et le paquetage sont vérifiés par GitHub Actions. Le fonctionnement Bluetooth doit encore être confirmé sur le Samsung S21 FE et le CRAFTY+ physiques.
