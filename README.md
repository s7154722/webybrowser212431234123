# Nova Search — Cloudflare Worker build

This version is set up for the `npx wrangler deploy` command used by the `webspacey` Workers deployment.

## What was fixed

The previous project used a Cloudflare Pages Function (`functions/api/search.js`), but the build log shows the site was deployed as a **Worker** using `npx wrangler deploy`. A Worker deployment does not automatically execute files in the Pages `functions/` directory. This version has a `worker.js` entry point that handles `/api/search` directly and serves the static website through the `ASSETS` binding.

It also tries DuckDuckGo's lightweight HTML endpoint if the main HTML endpoint fails to produce usable search results.

## Replace the files in your GitHub repository

1. Extract this ZIP.
2. Replace the old website files in the **root of your repository** with the contents of this ZIP. The repository root should contain `wrangler.jsonc`, `worker.js`, and the `public/` folder. Do not place the whole folder inside another folder.
3. Remove the old root-level `index.html`, `app.js`, `styles.css`, `favicon.svg`, `_headers`, and `functions/` directory if they are still present at the repository root. Their new copies are inside `public/` (except `functions/`, which is no longer needed).
4. Commit and push to GitHub. Keep the deployment command as `npx wrangler deploy`.

The config keeps the Worker name as `webspacey`, so it targets the same Worker name from the provided build log. The `run_worker_first` setting sends `/api/*` requests through the Worker while static website files are served from `public/`.

## Test after redeploy

Open `https://webspacey.s7154722.workers.dev/api/search?q=hello` in a browser. A working endpoint should return JSON containing `query`, `results`, and `provider`. If DuckDuckGo blocks the request or changes its HTML, the endpoint will return a JSON error rather than silently returning the webpage.

## Notes

- Search terms are sent to DuckDuckGo to fetch web results.
- Search results render in Nova; clicking a result opens the destination in a new tab.
- Safe Search is enabled and the region is set to Australian English.
- HTML scraping is less reliable than an official search API; DuckDuckGo may rate-limit requests or change its markup.
