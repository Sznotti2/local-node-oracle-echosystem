#!/bin/bash

# if there is an environment variable (from Docker), use it, otherwise localhost
CL_URL="${CHAINLINK_URL:-http://localhost:6688}"
ENV_FILE="./.env"

CREDENTIALS_FILE="./chainlink-config/apicredentials" 
CL_EMAIL=$(sed -n '1p' "$CREDENTIALS_FILE" | tr -d '\r')
CL_PASSWORD=$(sed -n '2p' "$CREDENTIALS_FILE" | tr -d '\r')

if [ -z "$CL_EMAIL" ] || [ -z "$CL_PASSWORD" ]; then
    echo "Error: The apicredentials file is empty or incomplete!"
    exit 1
fi


echo "⏳ Waiting for the Chainlink node ($CL_URL)..."
# Keep trying until the /health endpoint returns "passing" or a 200 status code
# Wait a maximum of 30 seconds
RETRIES=0
until curl -s "$CL_URL/health" | grep -q "passing" || [ $RETRIES -eq 30 ]; do
  echo "   ... node still loading (retry $RETRIES)"
  sleep 2
  ((RETRIES++))
done

if [ $RETRIES -eq 30 ]; then
    echo "Timeout: The Chainlink node did not start in time."
    exit 1
fi

echo "Chainlink node available. Logging in..."


# Login
COOKIE_JAR=$(mktemp)
curl -s -c "$COOKIE_JAR" -X POST "$CL_URL/sessions" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$CL_EMAIL\", \"password\":\"$CL_PASSWORD\"}" > /dev/null

# Fetch and parse address (using grep/cut to avoid needing jq)
RESPONSE=$(curl -s -b "$COOKIE_JAR" "$CL_URL/v2/keys/evm")
NODE_ADDRESS=$(echo $RESPONSE | grep -o '"address":"0x[a-fA-F0-9]*"' | head -1 | cut -d'"' -f4)

rm "$COOKIE_JAR"


# update .env file
if [ -z "$NODE_ADDRESS" ]; then
  echo "Error: Failed to extract the address via API."
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "Error: The $ENV_FILE file was not found!"
  exit 1
fi

echo "Found address: $NODE_ADDRESS"

# Check if NODE_WALLET exists
if grep -q "^NODE_WALLET=" "$ENV_FILE"; then
  # Replace with temp file
  sed "s/^NODE_WALLET=.*/NODE_WALLET=$NODE_ADDRESS/" "$ENV_FILE" > "$ENV_FILE.tmp"
  cat "$ENV_FILE.tmp" > "$ENV_FILE"
  rm "$ENV_FILE.tmp"
  echo ".env updated (NODE_WALLET replaced)."
else
  # Add
  echo "" >> "$ENV_FILE"
  echo "NODE_WALLET=$NODE_ADDRESS" >> "$ENV_FILE"
  echo ".env updated (NODE_WALLET added)."
fi