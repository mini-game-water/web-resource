#!/bin/bash
set -euo pipefail

# Install Docker
dnf update -y
dnf install -y docker git
systemctl enable docker
systemctl start docker

# Clone repo and build image locally
# IMPORTANT: All code changes (db.py, app.py, Dockerfile, requirements.txt)
# must be committed and pushed to main before running terraform apply.
cd /home/ec2-user
git clone https://github.com/mini-game-water/web-resource.git app
cd app

# Build Docker image
docker build -t ${docker_image} .

# Run the container
docker run -d \
  --name gamehub \
  --restart always \
  -p 5000:5000 \
  -e AWS_REGION=${aws_region} \
  -e USERS_TABLE=gamehub-users \
  -e ROOMS_TABLE=gamehub-rooms \
  -e NOTICES_TABLE=gamehub-notices \
  -e DMS_TABLE=gamehub-dms \
  -e SECRET_KEY='${app_secret_key}' \
  -e LOG_BUCKET=${log_bucket} \
  -e LOG_FLUSH_INTERVAL=60 \
  ${docker_image}

# Place deploy.sh in /home/ec2-user for easy re-deployment
cat > /home/ec2-user/deploy.sh << 'DEPLOY_EOF'
#!/bin/bash
set -euo pipefail

REPO="https://github.com/mini-game-water/web-resource.git"
APP_DIR="/home/ec2-user/app"
CONTAINER="gamehub"
IMAGE="gamehub:latest"

# ── Stop & remove old container ──
echo ">> Stopping old container..."
docker stop "$CONTAINER" 2>/dev/null || true
docker rm "$CONTAINER" 2>/dev/null || true

# ── Fresh clone ──
echo ">> Cloning repo..."
sudo rm -rf "$APP_DIR"
cd /home/ec2-user
git clone "$REPO" app
cd "$APP_DIR"

# ── Build image ──
echo ">> Building Docker image..."
docker build -t "$IMAGE" .

# ── Run new container ──
echo ">> Starting new container..."
docker run -d \
  --name "$CONTAINER" \
  --restart always \
  -p 5000:5000 \
  -e AWS_REGION=${aws_region} \
  -e USERS_TABLE=gamehub-users \
  -e ROOMS_TABLE=gamehub-rooms \
  -e NOTICES_TABLE=gamehub-notices \
  -e DMS_TABLE=gamehub-dms \
  -e SECRET_KEY='${app_secret_key}' \
  -e LOG_BUCKET=${log_bucket} \
  -e LOG_FLUSH_INTERVAL=60 \
  "$IMAGE"

echo ">> Done!"
docker ps --filter "name=$CONTAINER"
DEPLOY_EOF
chmod +x /home/ec2-user/deploy.sh
chown ec2-user:ec2-user /home/ec2-user/deploy.sh

# ══════════════════════════════════════════════
# Grafana OSS Installation
# ══════════════════════════════════════════════

# Install Grafana OSS RPM
dnf install -y https://dl.grafana.com/oss/release/grafana-11.4.0-1.x86_64.rpm

# Install Athena datasource plugin
grafana-cli plugins install grafana-athena-datasource

# ── Grafana configuration ──
cat > /etc/grafana/grafana.ini << GRAFANA_INI_EOF
[server]
http_port = 3000
root_url = https://${domain_name}/grafana/
serve_from_sub_path = true

[security]
admin_user = admin
admin_password = ${grafana_admin_password}

[auth.anonymous]
enabled = false

[log]
mode = console file
level = info
GRAFANA_INI_EOF

# ── Datasource provisioning ──
cat > /etc/grafana/provisioning/datasources/athena.yaml << DS_EOF
apiVersion: 1
datasources:
  - name: GameHub Athena
    type: grafana-athena-datasource
    uid: athena-gamehub
    access: proxy
    isDefault: true
    jsonData:
      authType: default
      defaultRegion: ${aws_region}
      catalog: AwsDataCatalog
      database: ${athena_database}
      workgroup: ${athena_workgroup}
      outputLocation: s3://${athena_results_bucket}/results/
DS_EOF

# ── Dashboard provisioning ──
cat > /etc/grafana/provisioning/dashboards/gamehub.yaml << 'DASHPROV_EOF'
apiVersion: 1
providers:
  - name: GameHub
    orgId: 1
    folder: ''
    type: file
    disableDeletion: false
    editable: true
    updateIntervalSeconds: 30
    options:
      path: /var/lib/grafana/dashboards
      foldersFromFilesStructure: false
DASHPROV_EOF

# ── Download dashboard JSON from S3 (too large for user_data 16KB limit) ──
mkdir -p /var/lib/grafana/dashboards
aws s3 cp s3://${log_bucket}/grafana/dashboard.json /var/lib/grafana/dashboards/gamehub.json --region ${aws_region}

chown -R grafana:grafana /var/lib/grafana/dashboards

# Start Grafana
systemctl daemon-reload
systemctl enable grafana-server
systemctl start grafana-server
