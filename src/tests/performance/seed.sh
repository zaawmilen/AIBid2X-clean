#!/bin/bash

echo "Logging in..."
LOGIN_RES=$(curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "password": "password123"}')

echo "Login response: $LOGIN_RES" # <-- see exact shape
TOKEN=$(echo $LOGIN_RES | jq -r '.accessToken')

echo "Fetching auctions..."
AUCTIONS_RES=$(curl -s http://localhost:3000/api/v1/auctions \
  -H "Authorization: Bearer $TOKEN")

echo "Auctions response: $AUCTIONS_RES" # <-- see exact shape
AUCTION_ID=$(echo $AUCTIONS_RES | jq -r '[.auctions[] | select(.status == "active")][0].id')

echo ""
echo "TOKEN=$TOKEN"
echo "AUCTION_ID=$AUCTION_ID"

if [ "$AUCTION_ID" = "null" ] || [ -z "$AUCTION_ID" ]; then
  echo "ERROR: Could not extract auction ID. Check the auctions response above."
  exit 1
fi

echo ""
echo "Run with:"
echo "k6 run -e BIDDER_TOKEN=$TOKEN -e AUCTION_ID=$AUCTION_ID src/tests/performance/bids-load.test.js"