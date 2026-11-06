# DJWaltin - YouTube to MP3 Downloader 🎵

A simple web application to download YouTube videos and convert them directly to MP3 audio files. 

## 📸 Screenshots

![Hero in the light theme: "Do vídeo ao vinil. em segundos." with the start button](docs/screenshots/hero-claro.png)

![Converter in the dark theme: pressing options, the record with the video cover, and the player with waveform](docs/screenshots/conversor-escuro.png)

<p align="center">
  <img src="docs/screenshots/celular-claro.png" alt="Phone, light theme" width="300">
  &nbsp;&nbsp;
  <img src="docs/screenshots/celular-escuro.png" alt="Phone, dark theme" width="300">
</p>

![Shelf with the history of recorded sound as LP sleeves](docs/screenshots/prateleira.png)

![Side B: tracklist of past conversions](docs/screenshots/tracklist-escuro.png)


## 🚀 How to Run

### 1. Install Dependencies (First time only)
```bash
pip install -r requirements.txt
```
### 2. Start the server
```bash
python app.py
```

### 3. Open in Your Browser
Go to: http://localhost:5000

### 4. Download
Paste the YouTube link.

Choose the quality.

Click "Converter para MP3".

💡 Note on files: The app doesn't clutter your project folder. It processes everything in a temporary system directory and streams the MP3 straight to your browser. After you save it, the file stays available for 2 more minutes (so the in-page player keeps working) and is then deleted. Converted files that are never saved are deleted after 30 minutes.

### Interface
Paste a link (or use the **COLAR** button) and the app shows a preview of the video (cover, title, channel, duration) plus the estimated MP3 size for each quality. During conversion it shows each step (connecting, downloading, converting, done). When it's ready you can listen to the MP3 with a waveform player before saving it. Recent conversions are listed below the panel, stored only in your browser.

---

### 5. Stop the Server
Press Ctrl + C in your terminal.

Pro Tip: Choose Where to Save
If your browser automatically downloads files to your default folder and you want it to ask you where to save the MP3 every time, change this setting:

Chrome / Edge: Settings > Downloads > Toggle on "Ask where to save each file before downloading"
Firefox: Settings > General > Downloads > Select "Always ask you where to save files"

## 🗂️ Project Structure

```
app.py                  HTTP routes only (Flask)
converter/
  config.py             temp folder, allowed qualities, cleanup timings
  jobs.py               Job dataclass + in-memory repository with timed cleanup
  youtube.py            yt-dlp wrapper: video metadata, MP3 download, friendly errors
  conversion.py         runs a conversion in a background thread and updates the Job
templates/
  Index.html            page skeleton + list of stylesheets
  partials/             one Jinja partial per section (Header, Hero, Shelf, Converter, Tracklist, Footer)
static/css/             one file per section, loaded in cascade order (Tokens first, Responsive/Motion last)
static/js/
  App.js                entry point: wires the components together
  lib/                  Dom (`ui` element lookup), Api client, Format, YouTube link check
  components/           Turntable, LinkField, Steps, Player, Tracklist, Toasts, ThemeToggle, Decorations
tests/                  backend tests (yt-dlp is mocked, no network needed)
```

Conventions:

- Front-end files (JS, CSS, templates) use PascalCase; Python modules stay lowercase (PEP 8).
- Code identifiers (variables, functions, classes, files) are in English. Comments and docstrings are in Portuguese, and so is what users see (interface text, error messages) and the data: API routes and JSON fields (`/api/baixar`, `qualidade`, `erro`, job status values) and the history stored in the browser.
- The screenshots above live in `docs/screenshots/`.
- Interface texts that belong to the markup (step descriptions, the busy button label) live in the HTML as `data-*` attributes, not in JavaScript constants.

## ✅ Tests

```bash
python -m unittest
```

## ☁️ Deploy on Render (Docker)

The app runs as a single long-lived process: jobs are kept in memory, conversions run in a background thread and files live in a temp folder. That is why it is deployed as a Docker web service, not as serverless functions (Vercel, Netlify, Lambda). FFmpeg is installed inside the image, so nothing has to be set up on the host.

Files involved:

- `Dockerfile`: Python 3.14 + FFmpeg + gunicorn, running as a non-root user.
- `render.yaml`: Render Blueprint (web service, Docker runtime, free plan, deploys the `main` branch).
- `.dockerignore`: keeps tests, docs and git history out of the image.

Steps:

1. Push the code to GitHub (`main` branch).
2. On [Render](https://render.com), choose **New → Blueprint** and select this repository. Render reads `render.yaml` and builds the `Dockerfile`.
3. Open the `*.onrender.com` URL when the deploy finishes. Each push to `main` deploys again.

Test the same image locally (requires Docker):

```bash
docker build -t djwaltin .
```

```bash
docker run --rm -p 10000:10000 djwaltin
```

Then open http://localhost:10000.

Things to know:

- **One worker only.** gunicorn runs with `--workers 1 --threads 8`. More workers would each have their own job list, and status polling would fail with "Job não encontrado.".
- **Free plan sleeps.** The instance stops after 15 minutes without traffic; the first visit after that takes a while, and jobs in progress are lost on restart.
- **YouTube may block cloud IPs** ("Sign in to confirm you're not a bot"). Fix it with a cookies file, see below.
- **Terms of use.** A public YouTube downloader conflicts with YouTube's Terms of Service. For personal use, keep the URL private or put the service behind authentication.

### YouTube cookies (when the server is blocked as a bot)

If conversions on Render fail with "O YouTube pediu verificação de que você não é um robô", give yt-dlp the cookies of a YouTube account. The app picks them up automatically from `/etc/secrets/cookies.txt` (or from the path in the `YTDLP_COOKIES` environment variable) and works on a temporary copy, so the original file is never modified. The image already ships Deno and `yt-dlp-ejs`, which YouTube requires when cookies are used.

> ⚠️ The cookies file gives access to the YouTube/Google account it came from. Treat it like a password: use a **secondary account** (YouTube may restrict accounts used for automated downloads), never commit it (`.gitignore` and `.dockerignore` already block `cookies.txt`) and never share it.

1. **Export the cookies** in Netscape format (the method recommended by yt-dlp, so YouTube does not rotate them right away):
   - open a private/incognito window and sign in to YouTube with the secondary account;
   - in the same tab, go to `https://www.youtube.com/robots.txt`;
   - export the cookies for `youtube.com` with an extension such as "Get cookies.txt LOCALLY" and save them as `cookies.txt`;
   - close the private window without signing out.
2. **Upload them to Render:** open the service → **Environment** → **Secret Files** → **Add Secret File**, name it `cookies.txt` and paste the file content. Save, then run **Manual Deploy → Deploy latest commit**.
3. **Delete the local copy** of `cookies.txt` once it is on Render.

Cookies expire after a while. If the bot error comes back, export them again and replace the secret file.

📌 Important Notes
FFmpeg Required: Make sure FFmpeg is installed and configured in your system's environment variables when running locally (the Docker image already includes it).
Local by default: `python app.py` only listens on localhost. It is reachable from the outside only if you deploy it (see above).
Disclaimer: Use this tool responsibly and only download content you have the rights to.
