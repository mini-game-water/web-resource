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
  -e SECRET_KEY='${app_secret_key}' \
  ${docker_image}
