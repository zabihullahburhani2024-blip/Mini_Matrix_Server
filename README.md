# Mini Matrix — Server Edition

Commercial gold & jewelry price calculator for wholesale (پاسه) and jewelry (زیورات) shops.

## Architecture

```
Twelve Data (XAU/USD WebSocket)
        │
        │  ONE connection only
        ▼
Mini Matrix FastAPI Backend  (Python)
        │
        │  Internal WebSocket /ws
        │  Broadcasts live price
        ▼
   ┌────┴────┬────────┐
   │         │        │
User 1   User 2  … User 200
(Mobile / Web Mini Matrix)
        │
        ▼
  ouncePrice → existing calculations
  + jewelry module (karat 23.88, mithqal, AFN…)
```

**The Twelve Data API key never leaves the backend.**

---

## Project structure

```
Mini_Matrix_Server/
├── backend/
│   ├── main.py              # FastAPI app + /ws
│   ├── market_data.py       # Twelve Data WS client + broadcast
│   ├── config.py
│   ├── requirements.txt
│   └── .env.example
├── frontend/                # Existing Mini Matrix UI (enhanced)
│   ├── index.html           # Menu: پاسه + زیورات
│   ├── app.html             # Wholesale dashboard
│   ├── jewelry.html         # NEW — Gold purchase/sale/mithqal/barg
│   ├── register.html
│   ├── js/
│   │   ├── api.js           # Now talks to OUR backend only
│   │   ├── ws-client.js     # NEW — client WebSocket
│   │   ├── goldCalculations.js  # NEW — karat / mithqal engine
│   │   ├── jewelry.js       # NEW
│   │   ├── app.js           # Wholesale (unchanged formulas)
│   │   └── …
│   └── css/
└── docs/
    └── DEPLOY.md
```

---

## Quick start (local)

### 1. Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env
# Edit .env and put your Twelve Data API key:
# TWELVE_DATA_API_KEY=your_real_key

python main.py
# → http://0.0.0.0:8000
# → WebSocket: ws://127.0.0.1:8000/ws
```

Check:
```bash
curl http://127.0.0.1:8000/health
curl http://127.0.0.1:8000/api/price
```

### 2. Frontend

Open `frontend/index.html` in a browser (or serve it):

```bash
cd frontend
python3 -m http.server 5500
# → http://127.0.0.1:5500
```

The frontend auto-connects to `ws://127.0.0.1:8000/ws`.

For production, set in a small config script or meta tag:
```js
window.MM_WS_URL = 'wss://api.yourdomain.com/ws';
```

---

## Jewelry module (زیورات)

- **Target karat**: fixed **23.88**
- **Mithqal**: 4.58 g @ 23.88K
- **Purchase**: New / Used (configurable % deduction, default 10%)
- **Sale**: no automatic used-gold deduction
- **USD → AFN**: shopkeeper enters rate (default 68)
- All values recalculate when live XAU/USD changes

Formulas live in `js/goldCalculations.js` (single source of truth).

---

## Wholesale module (پاسه)

Unchanged business logic:
- `DIVISOR = 2.56` (معادل فی توله)
- `GRAMS_PER_TOLA = 12.15`
- `GRAMS_PER_TROY_OUNCE = 31.10345`
- Live price now comes from backend WebSocket instead of direct Twelve Data REST.

---

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TWELVE_DATA_API_KEY` | Yes | Your Venture / trial key |
| `CLIENT_TOKEN` | No | Shared secret for `/ws?token=` |
| `HOST` / `PORT` | No | Default `0.0.0.0:8000` |
| `MAX_CLIENTS` | No | Default 300 |
| `CORS_ORIGINS` | No | Default `*` (tighten in production) |

---

## Security checklist

- [x] API key only on server (`.env`, never in JS)
- [x] One Twelve Data WebSocket for all users
- [x] Optional client token on `/ws`
- [x] Connection limit (`MAX_CLIENTS`)
- [ ] Use `wss://` + HTTPS in production
- [ ] Restrict `CORS_ORIGINS`
- [ ] Firewall: only 80/443 (and SSH) public
- [ ] Process manager (systemd / supervisord) with auto-restart

---

## Estimated cost (200 users)

| Item | Annual |
|------|--------|
| Twelve Data Venture | ~$1,490 |
| VPS (1–2 vCPU, 1–2 GB) | ~$60–120 |
| Domain | ~$10–15 |
| SSL (Let's Encrypt) | $0 |
| **Total** | **~$1,560–1,625** |
| **Per user / year** | **~$8–8.15** |
| **Per user / month** | **~$0.68** |

---

## Twelve Data WebSocket (official)

- URL: `wss://ws.twelvedata.com/v1/quotes/price?apikey=KEY`
- Subscribe: `{"action":"subscribe","params":{"symbols":"XAU/USD"}}`
- Event: `{"event":"price","symbol":"XAU/USD","price":...,"timestamp":...}`
- Bid/Ask not required / not always available for XAU/USD — we use mid/last only.

Docs: https://twelvedata.com/docs#websocket-api

---

## Production deployment

See **docs/DEPLOY.md** for:

- VPS recommendation
- Nginx / Caddy + SSL
- systemd unit
- Domain setup
- Capacitor (Android / iOS) notes
- Load-test outline for 200 clients

---

## License / commercial use

Architecture confirmed by Twelve Data for Venture commercial external display:
one server-side connection → internal distribution to Mini Matrix users.
Users only see prices inside the app; raw Twelve Data feed is not exposed.
