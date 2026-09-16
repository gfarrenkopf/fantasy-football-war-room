# Deploying the hosted app

How the hosted version (accounts, sync) runs in production: one DigitalOcean droplet running Node, Postgres and Caddy directly under systemd, with no Docker. **You don't need any of this to self-host the free app**; see [self-hosting.md](self-hosting.md).

Following this from a fresh droplet should take under an hour.

## Contents

1. [How it fits together](#1-how-it-fits-together)
2. [Create the droplet](#2-create-the-droplet)
3. [Secure the server](#3-secure-the-server)
4. [Install Node, Postgres and Caddy](#4-install-node-postgres-and-caddy)
5. [Create the database and app user](#5-create-the-database-and-app-user)
6. [First deploy](#6-first-deploy)
7. [HTTPS](#7-https)
8. [Backups](#8-backups)
9. [Day to day](#9-day-to-day)

---

## 1. How it fits together

```
internet ─443─▶ Caddy (TLS) ─▶ 127.0.0.1:3000 warroom.service (next start) ─▶ Postgres 17 on localhost
```

| Path | What |
|---|---|
| `/srv/warroom/releases/<sha>/` | One built checkout per deployed commit. The last 5 are kept. |
| `/srv/warroom/current`, `previous` | Symlinks to the live release and the one `rollback` returns to. |
| `/srv/warroom/repo.git` | A mirror of the GitHub repo, fetched on each deploy. |
| `/etc/warroom/.env` | Secrets, read by the app, the deploy script and the backup job. |
| `/var/backups/warroom/` | Nightly and pre-deploy database dumps. |

The files installed on the server live in [`deploy/`](../deploy): `deploy.sh`, `warroom.service`, `warroom-backup.service` and `.timer`, and `Caddyfile`. Each has a header comment explaining it.

## 2. Create the droplet

- **Image:** Ubuntu 24.04 LTS.
- **Size:** Basic, **2 GB RAM** / 1 vCPU or larger. `next build` runs on the droplet and can run out of memory with 1 GB, even with swap.
- **Authentication:** SSH key only.
- **Backups:** turn on DigitalOcean's droplet backups. They're your off-server copy of the database dumps (§8).
- **DNS:** add an `A` record for your domain (e.g. `warroom.example.com`) pointing at the droplet's IP. Do it now so it has propagated by §7.

Every command below runs over SSH. Replace `warroom.example.com` with your domain.

## 3. Secure the server

As `root`, create your own admin user with the same SSH key. Login is key-only, so it gets passwordless sudo, the same access root had:

```sh
adduser --disabled-password --gecos "" admin     # pick any name
usermod -aG sudo admin
rsync --archive --chown=admin:admin ~/.ssh /home/admin
echo 'admin ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/admin && chmod 440 /etc/sudoers.d/admin
```

Check that `ssh admin@<ip>` works from another terminal **before** continuing. Then, as `admin`:

```sh
# SSH: keys only, no root login
sudo tee /etc/ssh/sshd_config.d/10-hardening.conf >/dev/null <<'EOF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
EOF
sudo systemctl restart ssh

# Firewall: SSH and web only. Postgres and the app stay on localhost.
sudo ufw allow OpenSSH
sudo ufw allow 80,443/tcp
sudo ufw enable

# 2 GB swap as headroom for builds
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

sudo apt update && sudo apt upgrade -y
```

Ubuntu installs security updates automatically (`unattended-upgrades`).

## 4. Install Node, Postgres and Caddy

```sh
# Node 24 (matches .nvmrc) from NodeSource, installed at /usr/bin/node
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs git

# Postgres 17 from the PostgreSQL apt repo. The backup scripts need pg_dump at this version.
sudo apt install -y postgresql-common
sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
sudo apt install -y postgresql-17

# Caddy from its official apt repo
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy

node -v && psql --version && caddy version
```

Postgres listens on localhost only by default. Leave it that way.

## 5. Create the database and app user

```sh
# Database role and database. A hex password needs no escaping in DATABASE_URL.
DB_PASSWORD=$(openssl rand -hex 24)
sudo -u postgres psql -c "create role warroom login password '$DB_PASSWORD'"
sudo -u postgres psql -c "create database warroom owner warroom"

# The system user that builds and runs the app. Its home is /srv/warroom.
sudo useradd --system --create-home --home-dir /srv/warroom --shell /bin/bash warroom
sudo install -d -o warroom -g warroom -m 750 /var/backups/warroom

# Let warroom restart its own service, and nothing else, without a password
echo 'warroom ALL=(root) NOPASSWD: /usr/bin/systemctl restart warroom' | sudo tee /etc/sudoers.d/warroom
sudo chmod 440 /etc/sudoers.d/warroom

# Secrets
sudo install -d -m 750 -o root -g warroom /etc/warroom
sudo install -m 640 -o root -g warroom /dev/null /etc/warroom/.env
echo "DATABASE_URL=postgres://warroom:$DB_PASSWORD@localhost:5432/warroom" | sudo tee -a /etc/warroom/.env >/dev/null
echo "NEXTAUTH_SECRET=$(openssl rand -base64 32)" | sudo tee -a /etc/warroom/.env >/dev/null
echo "NEXTAUTH_URL=https://warroom.example.com" | sudo tee -a /etc/warroom/.env >/dev/null
sudo nano /etc/warroom/.env
```

In the editor, add at least one sign-in method. The variables are described in [self-hosting.md §6](self-hosting.md#6-environment-variables-and-hosted-features) and `.env.example`:

- **Google:** `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`. In Google Cloud, set the OAuth redirect URI to `https://warroom.example.com/api/auth/callback/google`.
- **Email link:** `AUTH_RESEND_KEY` and `EMAIL_FROM`. The sender's domain must be verified in Resend.

`NEXTAUTH_URL` must include the scheme (`https://warroom.example.com`, not `warroom.example.com`). Leave unused keys empty or delete them; an empty key counts as unset.

The file is `KEY=value` lines with no `export`. **Double-quote values that contain spaces**, e.g. `EMAIL_FROM="War Room <draft@example.com>"`. Both systemd and `deploy.sh` read it.

## 6. First deploy

The first run builds, backs up and migrates, but can't restart a service that isn't installed yet, so skip that step:

```sh
sudo -iu warroom bash -c '
  git clone --mirror https://github.com/gfarrenkopf/fantasy-football-war-room.git repo.git &&
  git -C repo.git show main:deploy/deploy.sh > /tmp/deploy.sh &&
  WARROOM_RESTART=true WARROOM_HEALTH_URL= bash /tmp/deploy.sh main'
```

Then install and start the units from the release:

```sh
cd /srv/warroom/current/deploy
sudo cp warroom.service warroom-backup.service warroom-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now warroom warroom-backup.timer
curl -sI http://127.0.0.1:3000 | head -1     # HTTP/1.1 200 OK
```

If it isn't running, check `journalctl -u warroom -n 50`. A `[config]` warning means a hosted feature is missing one of its variables.

## 7. HTTPS

```sh
sudo cp /srv/warroom/current/deploy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl edit caddy
```

In the editor, add:

```ini
[Service]
Environment=WARROOM_DOMAIN=warroom.example.com
```

```sh
sudo systemctl restart caddy
journalctl -u caddy -n 30      # look for "certificate obtained successfully"
```

Open `https://warroom.example.com` and sign in. Create a league, then open the site on another device and check that the league is there.

## 8. Backups

- **Nightly:** `warroom-backup.timer` runs `scripts/db-backup.sh` at 09:30 UTC and deletes dumps older than 14 days. Run one now and check it:

  ```sh
  sudo systemctl start warroom-backup && journalctl -u warroom-backup -n 5
  ls -lh /var/backups/warroom
  ```

- **Before every deploy:** `deploy.sh` takes a dump before it migrates. A failed backup stops the deploy.
- **Off the server:** dumps on the droplet's own disk don't survive losing the droplet. For now, DigitalOcean droplet backups (§2) are the off-server copy. Copying dumps to DigitalOcean Spaces is tracked in APE-108.

Restoring is covered in [database.md §5](database.md#5-backups-and-restore). On the droplet, the tools are already installed, so leave `PG_DOCKER_CONTAINER` unset and run the scripts as `warroom` with the env loaded:

```sh
sudo systemctl stop warroom
sudo -iu warroom bash -c 'set -a; . /etc/warroom/.env; set +a; cd current && npm run db:restore -- /var/backups/warroom/<dump> --yes && npm run db:migrate'
sudo systemctl start warroom
```

## 9. Day to day

| Task | Command |
|---|---|
| Deploy `main` | `sudo -iu warroom current/deploy/deploy.sh` |
| Deploy a branch, tag or commit | `sudo -iu warroom current/deploy/deploy.sh <ref>` |
| Roll back (run again to undo) | `sudo -iu warroom current/deploy/deploy.sh rollback` |
| What's live | `cat /srv/warroom/current/REVISION` |
| App logs | `journalctl -u warroom -f` |
| Restart | `sudo systemctl restart warroom` |
| Change a secret | edit `/etc/warroom/.env`, then restart. No rebuild needed. |

**Rollback only swaps code.** Migrations stay applied, so write schema changes to work with both the old and new code (add a column in one release, start relying on it in the next). To undo a bad migration, restore the dump that `deploy.sh` took just before it (§8).

If a deploy fails partway, the live app isn't touched. Fix the problem and run the deploy again; a build that already succeeded is reused.

When changing `deploy/*.service`, `.timer` or `Caddyfile`, copy the new versions into place as in §6 and §7 after deploying. `deploy.sh` doesn't install them.
