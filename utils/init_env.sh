#!/bin/sh

ENV_FILE="/app/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "Warning: The .env file was not found! Creating a new one with default values..."
  
  cat <<EOF > "$ENV_FILE"
NODE_ADDRESS=0x3816ca1E1f779Ff58fE99b38eA913B77be0c3c93
JOB_ID=1d320673e76245aab12ac929a794d2b2
LINKTOKEN_ADDRESS=0x5FbDB2315678afecb367f032d93F642f64180aa3
OPERATOR_ADDRESS=0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512
CONSUMER_ADDRESS=0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9
CHAINLINK_URL="http://localhost:6688"
NUMBER_OF_NODES=1
EOF

  echo ".env created successfully."
else
  echo ".env file already exists. Skipping creation."
fi