#!/bin/sh
echo "=== Check current Nginx config for location / ==="
grep -A5 'location / {' /www/server/panel/vhost/nginx/picup.ai-mendao.xyz.conf

echo ""
echo "=== Fix: ensure location / has proper no-cache + clean duplicates ==="
# The sed earlier may have added duplicate lines, let's view the full PROXY-CONF block
echo "=== Full PROXY-CONF block ==="
sed -n '/#PROXY-CONF-START/,/#PROXY-CONF-END/p' /www/server/panel/vhost/nginx/picup.ai-mendao.xyz.conf

echo ""
echo "=== Final verification ==="
INT=$(curl -sf http://127.0.0.1:3000 | grep -o 'page-[a-f0-9]*\.js' | head -1)
PUB=$(curl -sf --noproxy '*' https://picup.ai-mendao.xyz | grep -o 'page-[a-f0-9]*\.js' | head -1)
echo "Internal: $INT"
echo "Public:   $PUB"
if [ "$INT" = "$PUB" ]; then
  echo "MATCH OK"
else
  echo "STILL MISMATCHED"
fi

echo ""
echo "=== API health ==="
curl -sf --noproxy '*' https://picup.ai-mendao.xyz/api/health
echo ""

echo ""
echo "=== Upload test (POST to /api/files) ==="
curl -sf --noproxy '*' -X POST https://picup.ai-mendao.xyz/api/files -w "\nHTTP %{http_code}" 2>&1 | head -5
echo ""
