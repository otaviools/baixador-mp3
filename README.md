# YouTube to MP3 Downloader 🎵

A simple web application to download YouTube videos and convert them directly to MP3 audio files. 


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

Click "BAIXAR E CONVERTER".

💡 Note on files: The app doesn't clutter your project folder. It processes everything in a temporary system directory, automatically deletes it after the download finishes, and streams the MP3 straight to your browser.

---

### 5. Stop the Server
Press Ctrl + C in your terminal.

Pro Tip: Choose Where to Save
If your browser automatically downloads files to your default folder and you want it to ask you where to save the MP3 every time, change this setting:

Chrome / Edge: Settings > Downloads > Toggle on "Ask where to save each file before downloading"
Firefox: Settings > General > Downloads > Select "Always ask you where to save files"

📌 Important Notes
FFmpeg Required: Make sure FFmpeg is installed and configured in your system's environment variables.
Local Only: The server runs strictly on your localhost. It is completely private and inaccessible from the outside.
Disclaimer: Use this tool responsibly and only download content you have the rights to.
