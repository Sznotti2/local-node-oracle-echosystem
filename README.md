# Complete Guide: Running a Local Chainlink Node, LinkToken and oracle in Hardhat on Linux

This tutorial will guide you through setting up and running a Chainlink node on Ubuntu/Debian Linux systems.

## Running a Chainlink Node

### Using Docker

#### Run PostgreSQL in a Docker container. You can replace mysecretpassword with your own password
```bash
# This may take 10-15 minutes
docker run --name cl-postgres -e POSTGRES_PASSWORD=mysecretpassword -p 5432:5432 -d postgres

# Confirm that the container is running. Note the 5432 port is published 0.0.0.0:5432->5432/tcp and therefore accessible outside of Docker.
docker ps -a -f name=cl-postgres
# the output shpuld look like this
CONTAINER ID   IMAGE      COMMAND                  CREATED         STATUS         PORTS                    NAMES
dc08cfad2a16   postgres   "docker-entrypoint.s…"   3 minutes ago   Up 3 minutes   0.0.0.0:5432->5432/tcp   cl-postgres
```

#### Run Chainlink node

##### Configure your node

1. Create a local directory to hold the Chainlink data:
```bash
mkdir ~/.chainlink-local
```

2. Run the following as a command to create a config.toml file and populate with variables specific to the network you're running on

```bash
echo "[Log]
Level = 'warn'

[WebServer]
AllowOrigins = '\*'
SecureCookies = false

[WebServer.TLS]
HTTPSPort = 0

[[EVM]]
ChainID = '31337'

[[EVM.Nodes]]
Name = 'Local Hardhat Blockchain'
WSURL = 'ws://localhost:8545'
HTTPURL = 'http://localhost:8545'
" > ~/.chainlink-local/config.toml
```

3. Create a secrets.toml file with a keystore password and the URL to your database. Update the value for mysecretpassword to the chosen password in Run PostgreSQL.

```bash
echo "[Password]
Keystore = 'mysecretkeystorepassword'
[Database]
URL = 'postgresql://postgres:mysecretpassword@host.docker.internal:5432/postgres?sslmode=disable'
" > ~/.chainlink-local/secrets.toml
```
Because you are testing locally, add ?sslmode=disable to the end of your DATABASE_URL. However you should never do this on a production node!

4. Start the Chainlink Node by running the Docker image.
Change the version number in smartcontract/chainlink:2.28.0 with the version of the Docker image that you need to run. You can get that [from here](https://hub.docker.com/r/smartcontract/chainlink/tags).
```bash
cd ~/.chainlink-local && docker run --platform linux/amd64 --name chainlink -v ~/.chainlink-local:/chainlink -it -p 6688:6688 --add-host=host.docker.internal:host-gateway smartcontract/chainlink:2.28.0 node -config /chainlink/config.toml -secrets /chainlink/secrets.toml start
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


## Create Chainlink Configuration

### Create configuration directory
```bash
mkdir -p ~/.chainlink-local
cd ~/.chainlink-local
```

### Create config.toml file
```bash
cat > config.toml << 'EOF'
[[EVM]]
ChainID = '11155111'

[[EVM.Nodes]]
Name = 'local hardhat'
WSURL = 'ws://localhost:8545'
HTTPURL = 'http://localhost:8545'
EOF
```

### Create secrets.toml file
```bash
cat > secrets.toml << 'EOF'
[Password]
Keystore = 'password123456789'

[Database]
URL = 'postgresql://postgres:password123456789@127.0.0.1:5432/chainlink-local?sslmode=disable'
EOF
```

**Important:** Replace `password123456789` with the actual PostgreSQL password you set.

## Run Chainlink Node

### Start the node
```bash
cd ~/.chainlink-local
chainlink -c config.toml -s secrets.toml local n
```

### Set up API credentials
When prompted, enter:
- **API Email:** `admin@email.com` (or any email you prefer)
- **API Password:** `StrongPassword123` (choose a secure password)

### Access the Web Interface
Once the node is running, you can access the web interface at:
```
http://localhost:6688
```

Use the email and password you just created to log in.

### Check web interface
1. Open browser to http://localhost:6688
2. Log in with your API credentials
3. You should see the Chainlink dashboard
4. Copy the Node Address to the .env file
5. Create a new JOB, you can find an example in the the root directory
6. You can see that the JOB needs an Operator contract address, we'll get that after running the deploy-and-setup.ts script
7. After you replaced the placeholder with the address create the Job and copy the External Job ID and paste it into the .env file without "-"


# Running everithing together
```bash
npx hardhat node
# open a new terminal
cd .chainlink-local/
chainlink -c config.toml -s secrets.toml local n
#open a new terminal
python3 scripts/api.py runserver
#open a new terminal
npx hardhat run scripts/deploy-and-setup.ts --network localhost
# copy the Functions Router Address and add it to functions-job.toml
npx hardhat run scripts/checkWeather.ts --network localhost
```

## Troubleshooting

### Common Issues and Solutions

#### Nonce too high.

### Configure PostgreSQL
```bash
# Switch to postgres user
sudo -u postgres psql

# Set password for postgres user (use a strong password)
\password postgres
# Enter password: password123456789
# Confirm password: password123456789

# Drop database for Chainlink
DROP DATABASE "chainlink-local";

# Create database for Chainlink
CREATE DATABASE "chainlink-local";

# Exit PostgreSQL
\q
```

#### 1. Database Connection Error
```bash
# Check if PostgreSQL is running
sudo systemctl status postgresql

# Restart PostgreSQL if needed
sudo systemctl restart postgresql

# Test connection manually
psql -h localhost -U postgres -d chainlink-local
```

#### 2. Port Already in Use
```bash
# Check what's using port 6688
sudo lsof -i :6688

# Kill the process if needed
sudo kill -9 <PID>
```

#### 3. RPC Rate Limiting
If you see "Too Many Requests" errors:
- Upgrade your RPC provider plan, or
- Switch to a different provider, or
- Add rate limiting configuration to `config.toml`:

```toml
[[EVM]]
ChainID = '11155111'

[EVM.HeadTracker]
HistoryDepth = 10
MaxBufferSize = 10
SamplingInterval = '5s'

[[EVM.Nodes]]
Name = 'Sepolia'
WSURL = 'wss://your-websocket-url-here'
HTTPURL = 'https://your-http-url-here'
```

#### 4. Permission Denied
```bash
# Make sure chainlink binary is executable
which chainlink
ls -la $(which chainlink)

# If needed, make it executable
chmod +x $(which chainlink)
```

#### 5. Go Build Errors
```bash
# Update Go to latest version
sudo rm -rf /usr/local/go
# Then repeat Step 3 with latest Go version

# Clear Go module cache
go clean -modcache

# Try building again
make install
```
