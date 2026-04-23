#!/bin/bash

ENV_FILE="./.env"

# updating NUMBER_OF_NODES in .env
if grep -q "^NUMBER_OF_NODES=" "$ENV_FILE"; then
	sed "s|^NUMBER_OF_NODES=.*|NUMBER_OF_NODES=5|" "$ENV_FILE" > "$ENV_FILE.tmp"
	cat "$ENV_FILE.tmp" > "$ENV_FILE"
	rm "$ENV_FILE.tmp"
else
	echo "NUMBER_OF_NODES=5" >> "$ENV_FILE"
fi


NODES=("http://chainlink-1:6688" "http://chainlink-2:6688" "http://chainlink-3:6688" "http://chainlink-4:6688" "http://chainlink-5:6688")
for i in "${!NODES[@]}"; do
    NODE_ID=$((i+1))
    CL_URL="${NODES[$i]}"
    
	CREDENTIALS_FILE="./nodes/chainlink-config-$NODE_ID/apicredentials" 
	CL_EMAIL=$(sed -n '1p' "$CREDENTIALS_FILE" | tr -d '\r')
	CL_PASSWORD=$(sed -n '2p' "$CREDENTIALS_FILE" | tr -d '\r')

	if [ -z "$CL_EMAIL" ] || [ -z "$CL_PASSWORD" ]; then
		echo "Error: The apicredentials file is empty or incomplete!"
		exit 1
	fi

    echo "========================================================"
    echo "Waiting for Chainlink node $NODE_ID ($CL_URL)..."
    
    RETRIES=0
    until curl -s "$CL_URL/health" | grep -q "passing" || [ $RETRIES -eq 30 ]; do
		echo "   ... node $NODE_ID still loading (retry $RETRIES)"
		sleep 2
		((RETRIES++))
    done

    if [ $RETRIES -eq 30 ]; then
        echo "Timeout: Chainlink node $NODE_ID did not start in time."
        exit 1
    fi

    echo "Chainlink node $NODE_ID available. Logging in..."

    # login
    COOKIE_JAR=$(mktemp)
    curl -s -c "$COOKIE_JAR" -X POST "$CL_URL/sessions" \
        -H "Content-Type: application/json" \
        -d "{\"email\":\"$CL_EMAIL\", \"password\":\"$CL_PASSWORD\"}" > /dev/null

    RESPONSE=$(curl -s -b "$COOKIE_JAR" "$CL_URL/v2/keys/evm")
    NODE_ADDRESS=$(echo $RESPONSE | grep -o '"address":"0x[a-fA-F0-9]*"' | head -1 | cut -d'"' -f4)

    rm "$COOKIE_JAR"

    if [ -z "$NODE_ADDRESS" ]; then
		echo "Error: Failed to extract the address via API for node $NODE_ID."
		exit 1
    fi

    echo "Updating .env with NODE_ADDRESS_$NODE_ID=$NODE_ADDRESS"
    if grep -q "^NODE_ADDRESS_$NODE_ID=" "$ENV_FILE"; then
        sed "s|^NODE_ADDRESS_$NODE_ID=.*|NODE_ADDRESS_$NODE_ID=$NODE_ADDRESS|" "$ENV_FILE" > "$ENV_FILE.tmp"
        cat "$ENV_FILE.tmp" > "$ENV_FILE"
        rm "$ENV_FILE.tmp"
    else
        echo "NODE_ADDRESS_$NODE_ID=$NODE_ADDRESS" >> "$ENV_FILE"
    fi
    # adding CHAINLINK_URLs to .env
	if grep -q "^CHAINLINK_URL_$NODE_ID=" "$ENV_FILE"; then
		sed "s|^CHAINLINK_URL_$NODE_ID=.*|CHAINLINK_URL_$NODE_ID=$CL_URL|" "$ENV_FILE" > "$ENV_FILE.tmp"
		cat "$ENV_FILE.tmp" > "$ENV_FILE"
		rm "$ENV_FILE.tmp"
	else
		echo "CHAINLINK_URL_$NODE_ID=$CL_URL" >> "$ENV_FILE"
	fi
    
    echo "Node $NODE_ID setup complete!"
done

echo "========================================================"
echo "All 5 nodes have been successfully registered in .env!"