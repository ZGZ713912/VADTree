# VADTree Console frontend

React + Vite frontend for the local evidence console. All data comes from the
Python API in ../server; there is no mock data.

## Development

~~~bash
npm install
npm run dev        # http://127.0.0.1:5173, /api proxied to 127.0.0.1:8765
~~~

Keep the API running in another terminal:

~~~bash
cd ..
.venv/bin/python -m server.app --port 8765
~~~

## Production build

~~~bash
npm run build
~~~

The Python server serves ../webui/dist automatically when present.

## Screenshot and interaction checks

These scripts need Chromium. Set CHROME_PATH if the cached Playwright binary is
not at the default path.

~~~bash
node scripts/screenshot.mjs   # writes ../docs/screenshots/*.png
node scripts/verify.mjs       # overflow, strip navigation, fine tab, palette, runs
~~~
