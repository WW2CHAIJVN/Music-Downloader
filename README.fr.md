# Music Downloader

[简体中文](README.md) | [English](README.en.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Русский](README.ru.md) | [Español](README.es.md) | **[Français]**

Téléchargeur par lots de listes de lecture NetEase Cloud Music, avec une interface graphique Electron.

Collez un lien ou un identifiant de liste, choisissez un niveau de qualité : le téléchargeur récupère toute la liste et écrit automatiquement les balises ID3 et la pochette.

## Fonctionnalités

- Prend en charge les liens de liste de lecture, les identifiants de liste, les liens d'album, les liens de classement et les fichiers `.txt` de morceaux (chaque ligne commence par l'identifiant d'une chanson)
- 10 niveaux de qualité : standard / higher / exhigh / lossless / hires / jymaster / jyeffect / sky / vivid / dolby
- Si le niveau demandé n'est pas disponible, le niveau réel est rétrogradé automatiquement selon la chaîne de repli, avec une mention « 降級 » dans le journal
- Compteurs de progression en direct (réussis / ignorés / échoués / aperçu seul) et journal défilant
- Connexion par QR code ou collage d'un cookie, pour les morceaux VIP et sans perte
- Téléchargement reprenable (les fichiers existants de plus de 10 Ko sont ignorés) ; arrêt automatique sous 1,5 Go d'espace libre
- Serveur NetEase API intégré (`@neteasecloudmusicapienhanced/api`), aucun processus séparé

## Structure du projet

```
src/core/       cœur du téléchargement (download.js / match.js / login.js / rules.json)
src/main/       processus principal Electron et preload
src/renderer/   interface (HTML / CSS / JS)
```

## Développement

```powershell
npm install
npm start
```

### Construire l'installateur

```powershell
npm run dist
```

Les résultats sont dans `release/` :
- `MusicDownloader-Setup-<version>.exe` — installateur NSIS
- `win-unpacked/MusicDownloader.exe` — version portable

## Ligne de commande

`src/core/download.js` fonctionne aussi sans l'interface graphique :

```powershell
node src/core/download.js <lien-de-liste|ID|songs.txt> --level sky --out D:\Music
```

Options courantes :

| Option | Description |
|---|---|
| `--level` | Niveau de qualité, lossless par défaut |
| `--chain` | Chaîne de repli séparée par des virgules, ex. `jymaster,lossless` |
| `--out` | Répertoire de sortie |
| `--cookie` / `--cookie-file` | Cookie de connexion |
| `--concurrency` | Nombre de tâches parallèles, 4 par défaut |
| `--limit` | Ne télécharger que les N premiers morceaux |
| `--no-tag` | Ne pas écrire les balises ni la pochette |
| `--dry-run` | Résoudre les morceaux sans télécharger |

Nécessite un serveur API local :

```powershell
$env:PORT=3001; node .\node_modules\@neteasecloudmusicapienhanced\api\app.js
```

## Remarques

- Sans connexion, les morceaux VIP ne renvoient qu'un extrait de 45 secondes ; le script le détecte, ignore le morceau et le consigne dans `_result.json`
- Le cookie de connexion est stocké dans le répertoire de données utilisateur — **ne jamais le committer**
- Les droits sur les enregistrements téléchargés appartiennent à leurs ayants droit ; usage personnel et licite uniquement

## Dépendances

- `@neteasecloudmusicapienhanced/api` — API NetEase (fork maintenu par la communauté)
- Electron / electron-builder
- ffmpeg (pour les balises et la pochette ; doit être dans le `PATH`)
