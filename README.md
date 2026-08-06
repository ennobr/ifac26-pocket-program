# IFAC 2026 Pocket Program

Unofficial installable web app for the IFAC World Congress 2026 technical program.

## Use on iPhone

This is a static website and must be hosted over HTTPS for offline installation.

1. Upload the files to GitHub Pages, Netlify, Cloudflare Pages, or another static host.
2. Open the hosted URL in Safari.
3. Tap Share → Add to Home Screen.
4. Open the installed app and tap ↻ once to download the current PaperCept program.
5. After a successful sync, the schedule and favorites remain available offline.

## Local preview

Run a local web server in this folder:

    python3 -m http.server 8000

Then open http://localhost:8000 on a computer. iOS installation still requires an HTTPS-hosted version.

## Notes

- The program is tentative and may change.
- Sync reads the public PaperCept daily program pages through the r.jina.ai text gateway because PaperCept does not expose a documented public JSON API and cross-origin browser requests may be blocked.
- Favorites and cached program data are stored only in browser localStorage.
- This is not an official IFAC or PaperCept product.
