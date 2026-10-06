# Lecture factory on AWS (one EC2 server)

The same factory as on the PC — kind (Kubernetes in Docker), central, workers, factory MySQL —
on one Ubuntu EC2 server. Nothing in the pipeline changes; only `deploy/factory.mjs` knows it is
on Linux (pods reach the textbook DB through the kind network gateway instead of
`host.docker.internal`).

Tested shape: **c7i.2xlarge** (8 vCPU, 16 GB), Ubuntu, **100 GB gp3** root disk (the default 8 GB
is too small for the images, the work volume and videos waiting for upload).

## Lectures at once

`FACTORY_WORKERS` in the server's `.env` (default 2). Per worker: up to 2.5 GB RAM, ~2 vCPU while
rendering, 6 TTS requests at once.

| Workers | RAM (workers) | Gemini-TTS load | Notes |
|---|---|---|---|
| 3 | ~7.5 GB | ~55–70 req/min | safe start |
| 4 | ~10 GB | ~75–95 req/min | try after 3 runs clean; quota is 125/min per project |

The dashboard's Workers page can also scale while running; `FACTORY_WORKERS` is what a
redeploy restores.

## One-time setup

From the PC (key in `~/.ssh/config` as host `factory-aws`):

```bash
# code (tracked + untracked, not node_modules), textbook tables, secrets
git ls-files -z --cached --others --exclude-standard | tar --null -T - -czf repo.tgz
docker exec prepzy-mysql sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --set-gtid-purged=OFF tutorai classes subjects class_subject_mapping courses modules lectures textbook_raw | gzip' > tutorai.sql.gz
scp repo.tgz tutorai.sql.gz factory-aws:~/
scp .env factory-aws:~/.env.upload
```

On the server:

```bash
sudo growpart /dev/nvme0n1 1 && sudo resize2fs /dev/nvme0n1p1     # after enlarging the EBS volume
sudo apt-get install -y docker.io nodejs                            # Node 22 (nodesource)
sudo usermod -aG docker ubuntu                                      # log out and back in

mkdir -p ~/factory && tar -xzf ~/repo.tgz -C ~/factory && cd ~/factory && npm ci --omit=dev
mv ~/.env.upload .env && chmod 600 .env

# the textbook source (same role as prepzy-mysql on the PC), port 3307
docker run -d --name prepzy-mysql --restart unless-stopped -p 3307:3306 \
  -e MYSQL_ROOT_PASSWORD=<pw> -e MYSQL_DATABASE=tutorai -v prepzy-data:/var/lib/mysql mysql:8.0
gunzip -c ~/tutorai.sql.gz | docker exec -i prepzy-mysql mysql -uroot -p<pw> tutorai

# .env on the server
#   TEXTBOOK_DB_URL=mysql://root:<pw>@127.0.0.1:3307/tutorai
#   FACTORY_WORKERS=3
echo 'export FACTORY_LIBRARY=/home/ubuntu/library' >> ~/.profile    # read from the shell, not .env

npm run factory -- up
```

## Firewall (ufw, on the server)

ufw is on with "deny incoming". Allowed: 22 (SSH, GitHub deploys), 80 (nginx login), and 3307 from the kind
network only (`172.18.0.0/16`, the cluster reading the textbook DB). After `ufw enable` on a new server:

```bash
sudo ufw allow 22/tcp && sudo ufw allow 80/tcp
sudo ufw allow from 172.18.0.0/16 to any port 3307 proto tcp    # kind subnet: docker network inspect kind
```

The AWS security group needs inbound 22 and 80 as well; never 8080 or 3307.

## Daily use

- Dashboard: http://13.204.84.117 — nginx on port 80 with a login (user `prepzy`, password in
  `~/dashboard-password.txt` on the server; change it with `sudo htpasswd /etc/nginx/factory.htpasswd prepzy`).
  The dashboard itself has no login, so it stays bound to 127.0.0.1:8080; never open 8080 in the security group.
  Plain HTTP: add a domain + `certbot --nginx` for HTTPS.
  Public without login: `/privacy` (the privacy policy, `web/public/privacy.html`, linked from the
  Google / YouTube API application) — `location = /privacy { auth_basic off; … }` blocks in
  `/etc/nginx/sites-available/factory`, above the password-protected `location /`. The SSH tunnel
  (`ssh -L 8080:127.0.0.1:8080 factory-aws`, then http://localhost:8080) also still works.
- Code changes: push to `main`. `.github/workflows/deploy-aws.yml` runs the tests, swaps the code into
  `~/factory` (keeping the server's `.env`; the previous copy stays in `~/factory.prev`) and runs
  `npm run factory -- deploy`. Needs repository secrets `AWS_SSH_KEY` (the .pem contents) and `AWS_HOST`,
  and port 22 open to GitHub's runners. A lecture that is mid-way when the deploy restarts the workers
  is requeued and resumes from its last finished stage. `~/factory/DEPLOYED_COMMIT` shows what is live.
- Videos go to OneDrive and the local copy is deleted (unless `LIBRARY_KEEP_LOCAL=true`).
- Stop paying: stop the instance (disk kept, ~$8/month) or terminate it.
