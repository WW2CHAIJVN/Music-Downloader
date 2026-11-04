# Music Downloader

[简体中文](README.md) | [English](README.en.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Русский](README.ru.md) | **[Español]** | [Français](README.fr.md)

Descargador por lotes de listas de reproducción de NetEase Cloud Music, con interfaz gráfica de escritorio en Electron.

Pega el enlace o el ID de una lista, elige un nivel de calidad y descargará la lista completa escribiendo automáticamente las etiquetas ID3 y la carátula.

## Funciones

- Compatible con enlaces de lista de reproducción, ID de lista, enlaces de álbum, enlaces de listas de éxitos y archivos `.txt` con la lista de canciones (cada línea empieza por el ID de la canción)
- 10 niveles de calidad: standard / higher / exhigh / lossless / hires / jymaster / jyeffect / sky / vivid / dolby
- Si el nivel solicitado no está disponible, baja automáticamente por la cadena de reserva y lo marca como «degradado» en el registro
- Contadores de progreso en vivo (correctas / omitidas / fallidas / solo muestra) y registro con desplazamiento
- Inicio de sesión por código QR o pegando una cookie, para pistas VIP y sin pérdida
- Descarga reanudable (los archivos existentes de más de 10 KB se omiten); se detiene si quedan menos de 1,5 GB libres
- Servidor NetEase API integrado (`@neteasecloudmusicapienhanced/api`), sin proceso aparte

## Estructura del proyecto

```
src/core/       núcleo de descarga (download.js / match.js / login.js / rules.json)
src/main/       proceso principal de Electron y preload
src/renderer/   interfaz (HTML / CSS / JS)
```

## Desarrollo

```powershell
npm install
npm start
```

### Compilar el instalador

```powershell
npm run dist
```

Los resultados van a `release/`:
- `MusicDownloader-Setup-<version>.exe` — instalador NSIS
- `win-unpacked/MusicDownloader.exe` — versión portable

## Línea de comandos

`src/core/download.js` también funciona sin la interfaz gráfica:

```powershell
node src/core/download.js <enlace-de-lista|ID|songs.txt> --level sky --out D:\Music
```

Opciones habituales:

| Opción | Descripción |
|---|---|
| `--level` | Nivel de calidad, por defecto lossless |
| `--chain` | Cadena de reserva separada por comas, p. ej. `jymaster,lossless` |
| `--out` | Directorio de salida |
| `--cookie` / `--cookie-file` | Cookie de inicio de sesión |
| `--concurrency` | Número de tareas en paralelo, por defecto 4 |
| `--limit` | Descargar solo las primeras N pistas |
| `--no-tag` | No escribir etiquetas ni carátula |
| `--dry-run` | Solo resolver las pistas, sin descargar |

Requiere un servidor de API local:

```powershell
$env:PORT=3001; node .\node_modules\@neteasecloudmusicapienhanced\api\app.js
```

## Avisos

- Sin iniciar sesión, las pistas VIP solo devuelven una muestra de 45 segundos; el script lo detecta, omite la pista y la registra en `_result.json`
- La cookie de inicio de sesión se guarda en el directorio de datos del usuario — **nunca la subas al repositorio**
- Los derechos del audio descargado pertenecen a sus titulares; úsalo solo con fines personales y lícitos

## Dependencias

- `@neteasecloudmusicapienhanced/api` — API de NetEase (bifurcación mantenida por la comunidad)
- Electron / electron-builder
- ffmpeg (para etiquetas y carátula; debe estar en `PATH`)
