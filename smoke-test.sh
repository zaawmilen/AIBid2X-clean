#!/bin/bash

set -e

BASE_URL="https://aibid2x.fly.dev/api/v1"

echo "================================="
echo "1. Logging in..."
echo "================================="

TOKEN=$(curl -s -X POST "$BASE_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"prod-test@test.com","password":"12345678"}' \
  | jq -r '.accessToken')

if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
  echo "❌ Login failed"
  exit 1
fi

echo "✅ Login successful"

echo ""
echo "================================="
echo "2. Creating auction..."
echo "================================="

AUCTION_ID=$(curl -s -X POST "$BASE_URL/auctions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"title":"1959 Gibson Les Paul Production","startingPrice":250000,"endTime":"2026-12-31T23:59:59Z"}' \
  | jq -r '.auction.id')

if [ -z "$AUCTION_ID" ] || [ "$AUCTION_ID" = "null" ]; then
  echo "❌ Auction creation failed"
  exit 1
fi

echo "✅ Auction created"
echo "Auction ID: $AUCTION_ID"

echo ""
echo "================================="
echo "3. Activating auction..."
echo "================================="

RESPONSE=$(curl -s -X PATCH \
  "$BASE_URL/auctions/$AUCTION_ID/activate" \
  -H "Authorization: Bearer $TOKEN")

echo "$RESPONSE" | jq

STATUS=$(echo "$RESPONSE" | jq -r '.auction.status // .status // empty')

echo "Status: $STATUS"

echo ""
echo "================================="
echo "4. Streaming AI analysis..."
echo "================================="

curl -s -N \
  -H "Authorization: Bearer $TOKEN" \
  "$BASE_URL/auctions/$AUCTION_ID/analysis" | \
while IFS= read -r line
do
  [[ $line == data:* ]] && \
  echo "$line" | sed 's/^data: //' | \
  jq -r 'if .type=="text" then .text else empty end' 2>/dev/null | \
  tr -d '\n'
done

echo ""
echo ""

echo "✅ Smoke test completed"
