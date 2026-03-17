#!/bin/bash
#
# Node Service Console — Nginx + SSL 安装脚本
# 安装 Nginx、配置反向代理、申请 Let's Encrypt SSL 证书
#
set -e

DOMAIN="www.duidui-island.com"
APP_NAME="node-service-console"

# 适配不同发行版的 Nginx 配置路径
if [ -d /etc/nginx/sites-available ]; then
  # Debian / Ubuntu
  NGINX_CONF="/etc/nginx/sites-available/$APP_NAME"
  NGINX_ENABLED="/etc/nginx/sites-enabled/$APP_NAME"
  LINK_MODE="sites"
else
  # RHEL / CentOS / OpenCloudOS — 使用 conf.d 目录
  NGINX_CONF="/etc/nginx/conf.d/$APP_NAME.conf"
  NGINX_ENABLED=""
  LINK_MODE="confdir"
fi

echo "========================================="
echo "  Nginx + SSL 安装脚本"
echo "  域名: $DOMAIN"
echo "========================================="

if [ "$(id -u)" -ne 0 ]; then
  echo "错误：请使用 root 用户执行此脚本"
  exit 1
fi

# 1) 安装 Nginx 和 certbot
echo ""
echo "1) 安装 Nginx 和 Certbot ..."
if command -v apt-get &>/dev/null; then
  # Debian / Ubuntu
  apt-get update -qq
  apt-get install -y nginx certbot python3-certbot-nginx
elif command -v dnf &>/dev/null; then
  # Fedora / OpenCloudOS 9 / RHEL 9+
  dnf install -y nginx certbot python3-certbot-nginx
elif command -v yum &>/dev/null; then
  # CentOS 7/8 / OpenCloudOS 8
  yum install -y epel-release || true
  yum install -y nginx certbot python3-certbot-nginx
else
  echo "错误：无法识别包管理器，请手动安装 nginx 和 certbot"
  exit 1
fi

# 2) 创建 certbot 验证目录
mkdir -p /var/www/certbot

# 3) 先部署一个临时的纯 HTTP 配置（用于申请证书）
echo ""
echo "2) 部署临时 Nginx 配置 ..."
cat > "$NGINX_CONF" <<'TEMPEOF'
server {
    listen 80;
    server_name www.duidui-island.com duidui-island.com;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
        allow all;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_buffering off;
        proxy_cache off;
    }
}

map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
TEMPEOF

# 启用站点
if [ "$LINK_MODE" = "sites" ]; then
  ln -sf "$NGINX_CONF" "$NGINX_ENABLED"
  rm -f /etc/nginx/sites-enabled/default
fi

# 测试并启动/重载 Nginx
nginx -t
systemctl enable nginx
systemctl start nginx 2>/dev/null || systemctl reload nginx

echo ""
echo "3) 申请 SSL 证书 ..."
certbot certonly --webroot \
  -w /var/www/certbot \
  -d "$DOMAIN" \
  -d "duidui-island.com" \
  --non-interactive \
  --agree-tos \
  --email admin@duidui-island.com \
  --no-eff-email

# 4) 部署正式的 HTTPS 配置
echo ""
echo "4) 部署正式 HTTPS 配置 ..."
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cp "$SCRIPT_DIR/nginx.conf" "$NGINX_CONF"

# 测试并重载
nginx -t
systemctl reload nginx

# 5) 配置证书自动续期
echo ""
echo "5) 配置证书自动续期 ..."
# certbot 安装时通常已添加 systemd timer 或 cron job
# 手动确保 timer 启动
systemctl enable certbot.timer 2>/dev/null || true
systemctl start certbot.timer 2>/dev/null || true

# 确保续期后重载 nginx
mkdir -p /etc/letsencrypt/renewal-hooks/post
cat > /etc/letsencrypt/renewal-hooks/post/reload-nginx.sh <<'EOF'
#!/bin/bash
systemctl reload nginx
EOF
chmod +x /etc/letsencrypt/renewal-hooks/post/reload-nginx.sh

echo ""
echo "========================================="
echo "  Nginx + SSL 安装完成！"
echo "========================================="
echo ""
echo "  HTTPS: https://$DOMAIN/node-service-console"
echo "  HTTP 请求将自动跳转到 HTTPS"
echo ""
echo "  证书自动续期已配置（Let's Encrypt 证书 90 天有效）"
echo "  Nginx 日志: /var/log/nginx/node-service-console.*.log"
echo ""
