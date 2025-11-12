# Complete Guide: Running a Local Chainlink Node, LinkToken and oracle in Hardhat on Linux

## Table of Contents

- [Running a Chainlink Node](#running-a-chainlink-node)
  - [Using Docker](#using-docker)
  - [Builing From Source](#builing-from-source)
    - [Create Chainlink Configuration](#create-chainlink-configuration)
    - [Run Chainlink Node](#run-chainlink-node)
  - [Node Web GUI](#node-web-gui)
- [Running everithing together (built from source)](#running-everithing-together-from-source)
- [Running everithing together (docker)](#running-everithing-together-docker)
- [Troubleshooting](#troubleshooting)

## Running a Chainlink Node

This tutorial will guide you through setting up and running a local EVM and connect it to a Chainlink node on Ubuntu/Debian Linux systems.

### Using Docker

#### Create a bridge
```bash
docker network create chainlink-net
```

#### Run PostgreSQL in a Docker container. You can replace mysecretpassword with your own password
```bash
docker run -d --name cl-postgres --network chainlink-net \
  -e POSTGRES_USER=chainlink \
  -e POSTGRES_PASSWORD=mysecretpassword \
  -e POSTGRES_DB=chainlink_db \
  -p 5432:5432 \
  postgres:18 # Use a recent, supported version

# Confirm that the container is running. Note the 5432 port is published 0.0.0.0:5432->5432/tcp and therefore accessible outside of Docker.
docker ps -a -f name=cl-postgres
# the output shpuld look like this
CONTAINER ID   IMAGE      COMMAND                  CREATED         STATUS         PORTS                    NAMES
dc08cfad2a16   postgres   "docker-entrypoint.s…"   3 minutes ago   Up 3 minutes   0.0.0.0:5432->5432/tcp   cl-postgres
```

##### Configure your node

1. Create a local directory to hold the Chainlink data:
```bash
mkdir ~/.chainlink-local
```

2. Run the following as a command to create a config.toml file and populate with variables specific to the network you're running on

```bash
echo "[Log]
Level = 'info'

[WebServer]
AllowOrigins = '*'
SecureCookies = false

[WebServer.TLS]
HTTPSPort = 0

[[EVM]]
ChainID = '31337'
Enabled = true

[[EVM.Nodes]]
Name = 'Hardhat'
HTTPURL = 'http://host.docker.internal:8545'
WSURL = 'ws://host.docker.internal:8545'
" > ~/.chainlink-local/config.toml
```

3. Create a secrets.toml file with a keystore password and the URL to your database. Update the value for mysecretpassword to the chosen password in Run PostgreSQL.

```bash
echo "[Database]
URL = 'postgresql://chainlink:mysecretpassword@cl-postgres:5432/chainlink_db?sslmode=disable'

[Password]
Keystore = 'myChainlinkKeystorePassword123'
" > ~/.chainlink-local/secrets.toml
```
Because you are testing locally, add ?sslmode=disable to the end of your DATABASE_URL. However you should never do this on a production node!

4. Start the Chainlink Node by running the Docker image.
Change the version number in smartcontract/chainlink:2.28.0 with the version of the Docker image that you need to run. You can get that [from here](https://hub.docker.com/r/smartcontract/chainlink/tags).
```bash
cd ~/.chainlink-local && docker run --name chainlink --network chainlink-net -v ~/.chainlink-local:/chainlink -it -p 6688:6688 --add-host=host.docker.internal:host-gateway smartcontract/chainlink:2.29.0 node -config /chainlink/config.toml -secrets /chainlink/secrets.toml start
```

### Builing From Source

#### Update System Packages

```bash
sudo apt update && sudo apt upgrade -y && sudo apt autoremove
```

#### Install PostgreSQL Database

##### Install PostgreSQL
```bash
sudo apt install postgresql postgresql-contrib -y
```

##### Start and enable PostgreSQL service
```bash
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

##### Configure PostgreSQL
```bash
# Switch to postgres user
sudo -u postgres psql

# Set password for postgres user (use a strong password)
\password postgres
# Enter password: password123456789
# Confirm password: password123456789

# Create database for Chainlink
CREATE DATABASE "chainlink-local";

# Exit PostgreSQL
\q
```

##### Test database connection
```bash
psql -h localhost -U postgres -d chainlink-local
# Enter password when prompted
# Type \q to exit
```

#### Install Go (Required for Chainlink)

##### Download and install Go
```bash
# Remove any existing Go installation
sudo rm -rf /usr/local/go

# Download Go (check for latest version at https://golang.org/dl/)
wget https://go.dev/dl/go1.21.5.linux-amd64.tar.gz

# Extract to /usr/local
sudo tar -C /usr/local -xzf go1.21.5.linux-amd64.tar.gz

# Add Go to PATH
echo 'export PATH=$PATH:/usr/local/go/bin' >> ~/.bashrc
echo 'export GOPATH=$HOME/go' >> ~/.bashrc
echo 'export PATH=$PATH:$GOPATH/bin' >> ~/.bashrc

# Reload bash profile
source ~/.bashrc

# Verify installation
go version
```

#### Clone Chainlink repository
```bash
git clone https://github.com/smartcontractkit/chainlink.git
cd chainlink
```

#### Build Chainlink
```bash
# This may take 10-15 minutes
make install
```

#### Verify Chainlink installation
```bash
chainlink --version
```

#### Create Chainlink Configuration

##### Create configuration directory
```bash
mkdir -p ~/.chainlink-local
cd ~/.chainlink-local
```

##### Create config.toml file
```bash
cat > config.toml << 'EOF'
[Log]
Level = 'info'

[WebServer]
AllowOrigins = '*'
SecureCookies = false

[WebServer.TLS]
HTTPSPort = 0

[[EVM]]
ChainID = '31337'

[[EVM.Nodes]]
Name = 'local hardhat'
WSURL = 'ws://localhost:8545'
HTTPURL = 'http://localhost:8545'
EOF
```

##### Create secrets.toml file
```bash
cat > secrets.toml << 'EOF'
[Password]
Keystore = 'password123456789'

[Database]
URL = 'postgresql://postgres:password123456789@127.0.0.1:5432/chainlink-local?sslmode=disable'
EOF
```

**Important:** Replace `password123456789` with the actual PostgreSQL password you set.

#### Run Chainlink Node

##### Start the node
```bash
cd ~/.chainlink-local
chainlink -c config.toml -s secrets.toml local n
```

Use the email and password you just created to log in.

### Node Web GUI

#### Set up API credentials
Starting the node for the first time you will be prompted in the console to provide the API credentials:
- **API Email:** `admin@email.com` (or any email you prefer)
- **API Password:** `StrongPassword123` (choose a secure password)

#### Access the Web Interface
Once the node is running, you can access the web interface at:
```
http://localhost:6688
```
Log in with your API credentials

1. You should see the Chainlink dashboard
2. Copy the Node Address to the .env file
3. Create a new JOB, you can find an example in the the root directory
4. Copy the External Job ID and paste it into the .env file without dashes "-"


## Running everithing together (from source)
```bash
npx hardhat node
#open a new terminal
python3 scripts/api.py runserver
# open a new terminal
cd .chainlink-local/
chainlink -c config.toml -s secrets.toml local n
#open a new terminal
npx hardhat run scripts/deploy-and-setup.ts --network localhost
# copy the Functions Router Address and add it to functions-job.toml
npx hardhat run scripts/checkWeather.ts --network localhost
```

[Node Web GUI](#node-web-gui)

## Running everithing together (docker)
DISABLE FIREWALL or the node cannot connect to the EVM!
```bash
# Hardhat needs to be started differently
npx hardhat node --hostname 0.0.0.0 --port 8545
#open a new terminal
python3 scripts/api.py runserver
# open a new terminal
# if container exists: docker rm -f cl-postgres
docker run -d --name cl-postgres --network chainlink-net \
  -e POSTGRES_USER=chainlink \
  -e POSTGRES_PASSWORD=mysecretpassword \
  -e POSTGRES_DB=chainlink_db \
  -p 5432:5432 \
  postgres:18
# if container exists: docker rm -f chainlink
cd ~/.chainlink-local && docker run --name chainlink --network chainlink-net -v ~/.chainlink-local:/chainlink -it -p 6688:6688 --add-host=host.docker.internal:host-gateway smartcontract/chainlink:2.29.0 node -config /chainlink/config.toml -secrets /chainlink/secrets.toml start
# open a new terminal
npx hardhat run scripts/deploy-and-setup.ts --network localhost
# copy the Functions Router Address and add it to functions-job.toml
npx hardhat run scripts/checkWeather.ts --network localhost
```

if you can't see ndoe activity in the EVMs logs diable firewall

[Node Web GUI](#node-web-gui)

## Troubleshooting

#### Nonce too high.
#### Restart local PostgreSQL
```bash
# Switch to postgres user
sudo -u postgres psql

# Drop database for Chainlink
DROP DATABASE "chainlink-local";

# Create database for Chainlink
CREATE DATABASE "chainlink-local";

# Exit PostgreSQL
\q
```

### docker: Error response from daemon:

#### Conflict. The container name "..." is already in use by container ...
```bash
docker rm -f cl-postgres
```

#### failed to set up container networking: driver failed programming external connectivity on endpoint ...: failed to bind host port for 0.0.0.0:5432:172.19.0.2:5432/tcp: address already in use
```bash
sudo lsof -i :5432
sudo systemctl stop postgresql
docker rm -f cl-postgres
```

#### RPC Rate Limiting
If you see "Too Many Requests" errors:
- Upgrade your RPC provider plan, or
- Switch to a different provider, or
- Add rate limiting configuration to `config.toml`:

```toml
[[EVM]]
ChainID = '31337'

[EVM.HeadTracker]
HistoryDepth = 10
MaxBufferSize = 10
SamplingInterval = '5s'

[[EVM.Nodes]]
Name = 'Sepolia'
WSURL = 'wss://your-websocket-url-here'
HTTPURL = 'https://your-http-url-here'
```