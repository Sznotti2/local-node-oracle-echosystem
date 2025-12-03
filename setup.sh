#!/bin/bash
set -e # Kilépés hiba esetén

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

PROJECT_ROOT=$(pwd) # projekt gyökérkönyvtárát az abszolút útvonalhoz

# Add executable permission:
# chmod +x setup_chainlink.sh

echo "=== Setting up Local Chainlink for testing ==="

# --- 1. ELLENŐRZÉS: Fut-e lokális Postgres? ---
echo -e "${YELLOW}Checking local Postgres service...${NC}"
if systemctl is-active --quiet postgresql || lsof -Pi :5432 -sTCP:LISTEN -t >/dev/null ; then
    echo -e "${RED}ERROR: It seems the local Postgres service is running or the 5432 port is occupied.${NC}"
    echo "Please run this command: sudo systemctl stop postgresql"
    exit 1
fi

# --- 2. DOCKER NETWORK ---
echo -e "${YELLOW}Creating Docker network...${NC}"
# Csak akkor hozza létre, ha még nem létezik
docker network inspect chainlink-net >/dev/null 2>&1 || docker network create chainlink-net

# stop and remove old containers
echo -e "${YELLOW}Stopping and removing old containers...${NC}"
docker stop cl-postgres chainlink 2>/dev/null
docker rm cl-postgres chainlink 2>/dev/null

# --- 3. POSTGRES CONTAINER ---
echo -e "${YELLOW}Starting Postgres container...${NC}"
docker run -d --name cl-postgres --network chainlink-net \
      -e POSTGRES_USER=chainlink \
      -e POSTGRES_PASSWORD=mysecretpassword \
      -e POSTGRES_DB=chainlink_db \
      -p 5432:5432 \
      postgres:17 -c max_connections=200
    # -c max_connections=200 to better handle heavy load
echo "Waiting for the database to start (3s)..."
sleep 3

# --- 4. KONFIGURÁCIÓS FÁJLOK ---
echo -e "${YELLOW}Generating configuration files (~/.chainlink-local)...${NC}"
mkdir -p ~/.chainlink-local

cat <<EOF > ~/.chainlink-local/config.toml
[Feature]
LogPoller = true

[Log]
Level = 'info'

[WebServer]
AllowOrigins = '*'
SecureCookies = false

[WebServer.TLS]
HTTPSPort = 0

[Database]
MaxIdleConns = 20 
MaxOpenConns = 200 

[[EVM]]
ChainID = '31337'
Enabled = true
MinIncomingConfirmations = 1 
FinalityDepth = 1 
LogPollInterval = '100ms'
LinkContractAddress = '0x5FbDB2315678afecb367f032d93F642f64180aa3'
NoNewHeadsThreshold = '0' # Default '3m' ???
RPCDefaultBatchSize = 500 # Default 250

[[EVM.Nodes]]
Name = 'Hardhat'
HTTPURL = 'http://host.docker.internal:8545'
WSURL = 'ws://host.docker.internal:8545'

[EVM.Transactions]
MaxInFlight = 2000
MaxQueued = 5000
# Alapból a Node kb. 1-2 perc után pánikol.
# Állítsuk 1 órára ('1h'). Hardhaten úgysem tűnik el tranzakció.
# Így a Node nem fogja "Stuck"-nak jelölni, és nem spammeli a hibát.
ResendAfterThreshold = '1h' # default '1m'

[EVM.GasEstimator]
Mode = 'FixedPrice'
PriceDefault = '1 gwei'
BumpThreshold = 0

[EVM.GasEstimator.BlockHistory]
BlockHistorySize = 0
BatchSize = 250 # Default 25


[JobPipeline]
MaxSuccessfulRuns = 50

[Telemetry]
Enabled = false
EOF

cat <<EOF > ~/.chainlink-local/secrets.toml
[Database]
URL = 'postgresql://chainlink:mysecretpassword@cl-postgres:5432/chainlink_db?sslmode=disable'

[Password]
Keystore = 'myChainlinkKeystorePassword123'
EOF

echo -e "${YELLOW}Generating API authentication file (used in the GUI)...${NC}"
# Ez kell ahhoz, hogy ne kérjen emailt/jelszót indításkor a GUI-hoz
cat <<EOF > ~/.chainlink-local/apicredentials
user@example.com
myapipassword123
EOF

# --- 5. HÁTTÉRFOLYAMATOK KEZELÉSE (Hardhat + API) ---
# Trap: Ha leállítod a scriptet (Ctrl+C), ezeket a folyamatokat is lője le
cleanup() {
	echo ""
    echo "Terminating processes..."
    kill $HARDHAT_PID 2>/dev/null
    kill $API_PID 2>/dev/null
	kill $LOG_PID 2>/dev/null
	docker stop cl-postgres chainlink 2>/dev/null
    echo -e "${GREEN}All processes stopped.${NC}"
    exit 0
}
trap cleanup SIGINT SIGTERM EXIT

echo -e "${YELLOW}Starting Hardhat Node in background...${NC}"
# Logolás a hardhat.log fájlba, hogy ne zavarja a fő kimenetet
npx hardhat node --hostname 0.0.0.0 --port 8545 > hardhat.log 2>&1 &
HARDHAT_PID=$!
echo "Hardhat running (PID: $HARDHAT_PID). Logs: hardhat.log"
echo "Waiting for the blockchain to start (3s)..."
sleep 3

echo -e "${YELLOW}Starting API in background...${NC}"
node scripts/api.js > api.log 2>&1 &
API_PID=$!
echo "API running (PID: $API_PID). Logs: api.log"

# --- 6. STARTING CHAINLINK NODE (Background) ---
echo -e "${YELLOW}Starting Chainlink Node...${NC}"

# zárójelben futtatva nem változik meg a fő script aktuális könyvtára
# -d hogy háttérben fuson
(cd ~/.chainlink-local && docker run -d --name chainlink --network chainlink-net \
  -v ~/.chainlink-local:/chainlink \
  -p 6688:6688 \
  --add-host=host.docker.internal:host-gateway \
  smartcontract/chainlink:2.29.0 \
  node -config /chainlink/config.toml -secrets /chainlink/secrets.toml start -a /chainlink/apicredentials)

# Kis várakozás, hogy a container biztosan létezzen a logoláshoz
sleep 1

echo "================================================================"
echo -e "GUI: ${GREEN}http://localhost:6688${NC}"
echo -e "API Email: ${GREEN}user@example.com${NC}"
echo -e "API Password: ${GREEN}myapipassword123${NC}"
echo "================================================================"
echo "Copy the Chainlink Node Address into the .env file before running setup and tests!"
echo "Press Ctrl+C to stop all processes."

# --- LOGOLÁS (Tee használatával) ---
# A pipe (|) miatt a kimenet megy a képernyőre is, a tee pedig fájlba írja.
# A végén az '&' jel fontos, hogy a script ne akadjon meg itt, hanem eljusson a 'wait'-ig.
docker logs -f chainlink 2>&1 | tee "$PROJECT_ROOT/chainlink.log" &
LOG_PID=$!

# Életben tartja a scriptet
wait
