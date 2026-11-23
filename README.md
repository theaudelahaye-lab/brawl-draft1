# Draft Coach · assistant de draft pour le classé Brawl Stars

Appli web (PC et téléphone) à garder à côté du jeu. On dit à voix haute la map, les bans et les
picks adverses ; elle recommande quoi bannir et quoi choisir.

Application non officielle, sans lien avec Supercell. Aucun visuel du jeu n'est utilisé.

## Fonctionnement

- **Voix** : bouton micro (Chrome ou Edge, français). Exemples :
  « map Safe Zone », « bannis Mortis et Spike », « en face Colt », « on prend Piper »,
  « annule Colt », « nouvelle partie ». Sans mot-clé, un nom va dans la colonne active.
- **Ordre du classé** : 6 bans, puis picks 1-2-2-1. La case « Premier pick » indique qui commence.
- **Score** d'un brawler = force sur la map (winrate lissé) + contres face aux picks adverses
  + synergie avec nos picks + ajustement des patchs récents. Chaque conseil affiche le détail.
- **Ma collection** : cochez vos brawlers pour ne recevoir que des conseils jouables.

## Données

| Source | Contenu | Script |
|---|---|---|
| Brawlify (api.brawlapi.com) | brawlers, maps, rotation, winrates par map | `etl/fetch_brawlify.py` |
| API officielle Brawl Stars | historiques des meilleurs joueurs classés → nos propres winrates, contres, synergies | `etl/fetch_battlelogs.py` |
| Patch notes Supercell | buffs / nerfs | `etl/patch_notes.py` |

`etl/build.py` fusionne tout dans `web/public/data/db.json`.

### Clé de l'API officielle

1. Créez un compte sur https://developer.brawlstars.com et une clé autorisant l'IP **45.79.218.79**
   (proxy RoyaleAPI, nécessaire car GitHub Actions change d'IP à chaque exécution).
2. Ajoutez-la dans le dépôt : *Settings → Secrets and variables → Actions* → `BRAWLSTARS_API_KEY`.

Sans clé, l'appli fonctionne avec les seules stats Brawlify (pas de contres ni synergies).

### Après une mise à jour du jeu

```bash
python etl/fetch_brawlify.py
python etl/patch_notes.py --version "Nom du patch" --date 2026-11-20 notes.txt
python etl/build.py
```

Collez le texte des patch notes dans `notes.txt`. Le script devine buff/nerf ligne par ligne ;
relisez `data/patches.json`. Les patchs de moins de 14 jours pèsent sur les scores
tant que les statistiques ne les ont pas encore intégrés.

## Automatisation

`.github/workflows/update-data.yml` tourne chaque nuit : récupération, fusion, tests, build et
déploiement sur GitHub Pages (activez *Settings → Pages → Source : GitHub Actions*).

## Développement

```bash
cd web && npm install && npm run dev   # appli
npm test                               # tests du moteur et de la voix
python etl/test_etl.py                 # tests du pipeline
```
