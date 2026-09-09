# Demo → GDD

Paste a casino demo URL. The app asks a **Cursor agent** to inspect the game and return GDD fields (evidence only). We do not drive a browser ourselves — Cursor chooses tools and how to collect the data.

## Setup

```bash
cp .env.example .env
# set CURSOR_API_KEY
npm install
npm run dev
```

- UI: http://localhost:5173  
- API: http://localhost:3001  

Optional: enable browser / Playwright MCP in your Cursor app settings so the local agent can open demos. The app loads `user` / `project` / `team` setting sources.

## Env

| Variable | Description |
|----------|-------------|
| `CURSOR_API_KEY` | Required |
| `CURSOR_MODEL` | Default `composer-2` |
| `CURSOR_MODEL_PARAMS` | Default `{"fast":"true"}` |
| `PORT` | Default `3001` |

## Notes

- Unknown GDD cells stay empty.
- Extra discoveries become ADDITIONAL rows.
- Asset / Spine WBS is out of scope for v1.
