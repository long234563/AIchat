#!/usr/bin/env bash
set -eu
cd "$(dirname "$0")"
command -v node >/dev/null || { echo 'Cần Node.js >= 20: https://nodejs.org/'; exit 1; }
if [ ! -f .env ]; then
  cp .env.example .env
  echo 'Đã tạo .env — hãy điền GEMINI_API_KEY, lưu lại, rồi chạy lại.'
  exit 1
fi
echo 'long AI: http://localhost:3012/'
node server.js
