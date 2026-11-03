# Deploy — server setup

Ce rulează unde, și cum se reface totul dacă se schimbă VPS-ul din nou (s-a
mai întâmplat o dată — vechiul VPS a devenit indisponibil fără niciun
backup al configurării nginx, de-asta e documentat acum).

## Topologie

- **VPS**: Ubuntu 26.04, IP curent `89.144.53.209`, domeniu `totalvizibil.ro`
  (+ `www.`).
- **User de deploy**: `deploy` (non-root), autentificare doar prin cheie SSH.
  Are sudo limitat strict la `systemctl reload/restart nginx` + `nginx -t`
  (vezi `/etc/sudoers.d/deploy-nginx` pe server).
- **Cod**: clonat la `/var/www/totalvizibil`, pe branch `main`.
- **Backend**: Node 20 (via NVM, sub userul `deploy`), pornit cu PM2 sub
  numele `tvz-api`, ascultă pe `127.0.0.1:3000`, prefix `/api/v1`. PM2 e
  înregistrat ca serviciu systemd (`pm2-deploy.service`) — revine singur
  după reboot.
- **Frontend**: build static în `project/frontend/dist`, servit direct de
  nginx.
- **Baza de date**: PostgreSQL nativ (NU Docker) — rol + bază `tvz`, parolă
  în `project/backend/.env` de pe server (nu e în git).
- **nginx**: `deploy/nginx/totalvizibil.conf` (versionat aici) →
  `/etc/nginx/sites-available/totalvizibil.conf`, symlink în
  `sites-enabled`. SSL prin Let's Encrypt/certbot (`--nginx`, auto-renew
  deja programat de certbot).
- **CI/CD**: `.github/workflows/deploy.yml` — push pe `main` rulează testele,
  apoi SSH cu `secrets.VPS_HOST`/`VPS_USER`/`VPS_SSH_KEY` → `git pull` +
  `prisma migrate deploy` + rebuild backend/frontend + `pm2 restart tvz-api`.
  Fișierul nu are nevoie de modificări dacă se schimbă doar VPS-ul — doar
  valorile secretelor din GitHub.

## Dacă se schimbă iarăși VPS-ul

1. Instalează: `nginx certbot python3-certbot-nginx git build-essential ufw
   postgresql postgresql-contrib`.
2. `ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable`.
3. Creează userul `deploy`, generează o cheie SSH NOUĂ local
   (`ssh-keygen -t ed25519`), pune cheia publică în
   `~deploy/.ssh/authorized_keys`, dă-i sudo limitat la nginx (vezi mai sus).
4. NVM + `nvm install 20` + `npm i -g pm2`, ca user `deploy`.
5. `git clone https://github.com/bennixm/totalvizibil /var/www/totalvizibil`
   (repo public, nu are nevoie de deploy key).
6. Creează rol + bază Postgres (`CREATE ROLE tvz LOGIN PASSWORD '...'`,
   `createdb -O tvz tvz`), scrie `project/backend/.env` (copiază din
   `.env.example`, completează `DATABASE_URL`, `FRONTEND_ORIGIN=https://totalvizibil.ro`,
   `SESSION_COOKIE_SECURE=true`; cheile externe — Anthropic/Stripe/SMTP/
   Pexels/DeepSeek — le pune proprietarul platformei, nu sunt critice pentru
   boot).
7. `npx prisma migrate deploy`, `npm run build` pe backend, `pm2 start
   dist/main.js --name tvz-api && pm2 save`, apoi `pm2 startup systemd -u
   deploy --hp /home/deploy` (comanda `sudo env PATH=...` pe care o
   afișează trebuie rulată ca root).
8. `npm run build` pe frontend.
9. Copiază `deploy/nginx/totalvizibil.conf` din acest repo pe server, link
   în `sites-enabled`, `nginx -t && systemctl reload nginx`.
10. Repunctează DNS-ul (A record) spre noul IP, așteaptă propagarea, apoi
    `certbot --nginx -d totalvizibil.ro -d www.totalvizibil.ro --redirect`.
    **După asta, re-sincronizează `deploy/nginx/totalvizibil.conf` din
    fișierul live de pe server** — certbot îl modifică direct acolo.
11. Actualizează `VPS_HOST`/`VPS_USER`/`VPS_SSH_KEY` în GitHub Secrets cu
    noile valori.

## Ce NU e în git (intenționat)

- `project/backend/.env` de pe server — parola bazei de date + orice cheie
  API reală.
- Cheia privată SSH a userului `deploy`.
