# Mettre Draft Coach en ligne (GitHub Pages)

Comptez 10 minutes. Tout est gratuit.

## 1. Créer le dépôt
1. Sur https://github.com/new : nom `brawl-draft`, visibilité **Public** (Pages est gratuit pour les dépôts publics).
2. Ne cochez rien d'autre, puis **Create repository**.

## 2. Activer GitHub Pages et les droits du robot (avant d'envoyer le code)
1. Dans le dépôt : **Settings → Pages → Build and deployment → Source : GitHub Actions**.
2. **Settings → Actions → General → Workflow permissions : Read and write permissions** → Save.

## 3. Envoyer le code
1. Décompressez `brawl-draft.zip` sur votre ordinateur.
2. Sur la page du dépôt, cliquez **uploading an existing file**.
3. Ouvrez le dossier `brawl-draft` décompressé, sélectionnez **tout son contenu** (pas le dossier lui-même)
   et glissez-le dans la page. Vérifiez que le dossier `.github` fait partie de la liste :
   - Windows : il est visible normalement.
   - Mac : dans le Finder, `Cmd + Maj + .` affiche les dossiers cachés.
4. **Commit changes**.

## 4. Premier lancement
1. Onglet **Actions** : le workflow « Mise à jour des données et déploiement » démarre tout seul
   (sinon : cliquez-le puis **Run workflow**).
2. Au bout de 2 à 3 minutes, il passe au vert. L'adresse de l'appli s'affiche dans l'étape *deploy* :
   `https://<votre-pseudo>.github.io/brawl-draft/`
3. Ouvrez-la dans **Chrome** (PC ou Android) ou **Safari** (iPhone), autorisez le micro.
   Pour l'installer comme une appli : menu du navigateur → *Ajouter à l'écran d'accueil*.
4. Envoyez le lien à votre ami : chacun utilise sa propre copie.

## 5. Débloquer contres et synergies (recommandé)
1. Créez un compte sur https://developer.brawlstars.com → **My Account → Create New Key**.
2. Dans *Allowed IP addresses*, mettez **45.79.218.79** (relais RoyaleAPI utilisé par GitHub).
3. Copiez la clé, puis dans le dépôt : **Settings → Secrets and variables → Actions → New repository secret**,
   nom `BRAWLSTARS_API_KEY`, valeur = la clé.
4. **Actions → Run workflow**. Les données s'enrichissent ensuite chaque nuit.

## En cas d'échec
Une croix rouge dans **Actions** : ouvrez l'étape en erreur et copiez le message à Claude.
