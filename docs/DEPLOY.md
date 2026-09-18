# Mini Matrix — Production Deployment Guide

## 1. Recommended VPS

| Spec | Minimum | Recommended |
|------|---------|-------------|
| CPU | 1 vCPU | 2 vCPU |
| RAM | 1 GB | 2 GB |
| Disk | 20 GB SSD | 40 GB SSD |
| OS | Ubuntu 22.04 / 24.04 LTS | same |
| Bandwidth | 1 TB | 2 TB |

**Providers (approx. monthly):** Hetzner CX22 (~€4–6), DigitalOcean Basic ($6), Contabo, Vultr.

Annual VPS: roughly **$60–120**.

Python: **3.10+** (3.11 or 3.12 preferred).

---

## 2. Server setup (Ubuntu)

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y python3 python3-venv python3-pip nginx certbot python3-certbot-nginx git
```

Clone / upload project:

```bash
sudo mkdir -p /opt/minimatrix
sudo chown $USER:$USER /opt/minimatrix
# upload Mini_Matrix_Server contents here
cd /opt/minimatrix/backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
nano .env   # set TWELVE_DATA_API_KEY=...
```

---

## 3. systemd service

`/etc/systemd/system/minimatrix.service`:

```ini
[Unit]
Description=Mini Matrix Backend
After=network.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/opt/minimatrix/backend
Environment=PATH=/opt/minimatrix/backend/venv/bin
ExecStart=/opt/minimatrix/backend/venv/bin/python main.py
Restart=always
RestartSec=5
EnvironmentFile=/opt/minimatrix/backend/.env

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable minimatrix
sudo systemctl start minimatrix
sudo systemctl status minimatrix
```

---

## 4. Nginx reverse proxy + SSL

Domain example: `api.yourdomain.com`

DNS: A record → VPS IP.

Nginx site:

```nginx
server {
    listen 80;
    server_name api.yourdomain.com;
    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/minimatrix /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d api.yourdomain.com
```

After SSL:

- REST: `https://api.yourdomain.com`
- WebSocket: `wss://api.yourdomain.com/ws`

Optional: serve frontend static files from same or another domain (`app.yourdomain.com`).

---

## 5. Frontend production config

Before packaging / hosting the frontend, set:

```html
<script>
  window.MM_WS_URL = 'wss://api.yourdomain.com/ws';
  // window.MM_CLIENT_TOKEN = 'optional-shared-secret';
</script>
```

Place this **before** `js/ws-client.js` / `js/api.js`.

---

## 6. Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

Do **not** expose port 8000 publicly; only Nginx on 80/443.

---

## 7. Capacitor (Android / iOS)

```bash
npm install @capacitor/core @capacitor/cli
npx cap init "Mini Matrix" com.yourcompany.minimatrix
# Copy frontend build into www/
npx cap add android
npx cap add ios
npx cap sync
```

- Use **only** `wss://` in production builds.
- Allow cleartext only for local debug if needed.
- Test background/foreground WebSocket reconnect (already handled by `ws-client.js`).

---

## 8. Simple load test (200 clients)

From any machine with Python:

```python
# scripts/load_ws.py (example)
import asyncio, websockets, json

URL = "ws://YOUR_SERVER:8000/ws"
N = 200

async def client(i):
    async with websockets.connect(URL) as ws:
        async for msg in ws:
            data = json.loads(msg)
            if data.get("type") == "market_update":
                print(i, data["price"])
                break  # or keep open

async def main():
    await asyncio.gather(*[client(i) for i in range(N)])

asyncio.run(main())
```

Watch backend logs and `/api/status` for `client_count`.

---

## 9. Backup & recovery

- `.env` and activation codes: back up securely (not in public git).
- No database required for price distribution (in-memory).
- Optional: log price updates to a daily JSONL file for TradingView comparison.

---

## 10. Troubleshooting

| Symptom | Check |
|---------|--------|
| No price | `TWELVE_DATA_API_KEY`, `journalctl -u minimatrix -f` |
| Clients can't connect | Nginx `Upgrade` headers, firewall, CORS |
| Stale price | TD reconnect logs; backend still has last valid price |
| Max clients | Increase `MAX_CLIENTS` or scale horizontally later |

Health: `curl https://api.yourdomain.com/health`
