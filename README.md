# Complete Guide: Running a Local Oracle Network
**Project Context**: This repository contains the practical implementation and measurement environment for my BSc Thesis on "Blockchain-based Insurance system using Smart Contracts and Oracles".

This project establishes a fully containerized, local blockchain ecosystem designed to stress-test Chainlink Oracle Nodes. Unlike standard testnet setups, this environment eliminates external network latency, allowing for precise analysis of the middleware's "breaking points," throughput limits (TPS), and internal bottlenecks (e.g., database locking, RPC synchronization).


If you encounter any error or unusual behaviour, visit the [troubleshooting section](#troubleshooting), 
as it has solutions to common problems.

## Table of Contents

- [Complete Guide: Running a Local Oracle Network](#complete-guide-running-a-local-oracle-network)
	- [Table of Contents](#table-of-contents)
	- [Core Components](#core-components)
	- [Prerequisites](#prerequisites)
	- [Install](#install)
	- [Setup](#setup)
	- [Running Experiments](#running-experiments)
		- [Request Tracing (Demo)](#request-tracing-demo)
		- [System Diagnostics](#system-diagnostics)
		- [Test the Network](#test-the-network)
			- [Basic Stress Test](#basic-stress-test)
			- [Step-load Stress Test](#step-load-stress-test)
		- [Metrics gathered:](#metrics-gathered)
		- [Useful Commands \& Monitoring](#useful-commands--monitoring)
	- [Configuration \& Optimization](#configuration--optimization)
	- [Project Structure](#project-structure)
	- [Troubleshooting](#troubleshooting)
		- [Port is already in use](#port-is-already-in-use)
		- [Chainlink node is unresponsive/doesn't register new requests / "RPC endpoint detected out of sync" in chainlink logs](#chainlink-node-is-unresponsivedoesnt-register-new-requests--rpc-endpoint-detected-out-of-sync-in-chainlink-logs)

## Core Components
The system operates as a microservices cluster orchestrated via Docker Compose:
 - **Hardhat Node (v2):** Local Ethereum blockchain running in `auto-mining` mode for zero-latency block production to test the oracle's reaction speed.
 - **Chainlink Node (v2.29.0):** The oracle middleware, heavily tuned for high throughput. (see [Documentation](https://docs.chain.link/chainlink-nodes/v1/node-config))
 - **PostgreSQL:** Stores node state, job runs, and keystore. Tuned for high concurrency.(`max_connections=300`)
 - **Local API:** A lightweight Express.js server simulating a weather data provider to eliminate internet latency variability.
 - **Automation Scripts:** You'll find scripts and enviorment files that automate the *"boring stuff"*: deploys contracts, funds the node wallet, runs tests.

## Prerequisites
- **Docker Desktop** (or Docker Engine + Compose Plugin)
- **Node.js v20** (use with nvm if you haven't already)
- **npm** or *yarn*


## Install
1. Clone and Install Dependencies

```bash
git clone https://github.com/Sznotti2/local-node-oracle-echosystem.git
cd local-node-oracle-echosystem
cp .env.example .env # create .env file
npm i
docker-compose up -d --build # it will take some time
```

The docker-compose command will build and start 4 containers in detached mode using the `-d` flag.

## Setup
After installation finishes:
1. log in to the node's UI at http://localhost:6688
- *API Email:* `admin@email.com`
- *API Password:* `StrongPassword123`
  
(credentials are stored in chainlink-config/apicredentials)

2. copy the Node's Wallet Address and paste it in the *.env* file (NODE_ADDRESS=...)
3. copy the code from chainlink-config/job.toml and go back to the UI, 
4. click on "New Job" button
5. paste the code in the textarea
6. click on "Create Job"

in the terminal run
```bash
npm run setup
```

**The steps in [Setup](#setup) needs to be done every time the network is restarted!**

## Running Experiments
This project includes specialized scripts to trace transactions and perform load testing. All scripts should be run from your host machine.

### Request Tracing (Demo)
Follows the lifecycle of a single Chainlink request across the network (Consumer -> LinkToken -> Operator -> Node -> Operator -> Consumer). Useful for verifying system health.
```bash
npm run demo
```

### System Diagnostics
Checks the ETH and LINK balances of all components.
```bash
npm run balance
```

### Test the Network

**Be careful when using test scripts as they can easily freeze your machine with request counts exceeding 1000!**

It is advised to run tests with performance monitoring software as it *will* push both your system and this network to its *limits*,

#### Basic Stress Test
Simple test script that will prompt you how many requests you want to send. 
```bash
npm run stress-test
```

#### Step-load Stress Test
This script incrementally increases the load (e.g., 10 -> 50 -> 100 -> 1000 requests) to find the exact point where the system fails or latency becomes unacceptable.
```bash
npm run step-test
```

### Metrics gathered:
- Throughput: Effective Transactions Per Second.
- Node Latency: Time taken by the node to process the event (excluding block time)
- Total experiment time: from the first sent request to the last received

### Useful Commands & Monitoring

```bash
docker-compose up -d # runs all containers in detached mode
docker-compose down -v # stops all containers and deletes databse
docker-compose restart <chainlink | api | hardhat | cl-postgres> # restarts container
docker-compose logs -f <chainlink | api | hardhat | cl-postgres> # prints live logs of specified container
docker-compose logs -f --tail=50 <chainlink | api | hardhat | cl-postgres> # last 50 Hardhat Logs
docker-compose ps # shows container status
```

## Configuration & Optimization

A key part of this thesis work was tuning the Chainlink Node to survive high-load simulation. The default "production" settings are too conservative for auto-mining networks.

| Parameter                  | Default | Optimized           | Description / Function                                                                                                      |
| -------------------------- | ------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `LogPoller`                | false   | true                | Enables the V2 event polling mechanism required for the Direct Request model to detect on-chain events                      |
| `MaxIdleConns`             | 10      | 20                  | Sets the maximum number of idle PostgreSQL connections kept open in the connection pool for immediate reuse                 |
| `MaxOpenConns`             | 100     | 250                 | Defines the hard limit on the total number of concurrent connections allowed between the node and the PostgreSQL database.  |
| `MinIncomingConfirmations` | 3       | 1                   | Specifies the number of blocks the node must wait after an event is emitted before triggering a job run (to prevent reorgs) |
| `LogPollInterval`          | 15s     | 1s                  | Controls the frequency at which the node queries the RPC endpoint for new event logs                                        |
| `FinalityDepth`            | 50      | 1                   | Determines the number of blocks after which the node considers a transaction or log to be immutable (final)                 |
| `NoNewHeadsThreshold`      | 3m      | 0                   | Defines the timeout duration for receiving new block headers before declaring the upstream RPC endpoint unresponsive        |
| `HTTPURL`                  | -       | http://hardhat:8545 | Specifies the HTTP(S) endpoint address. Used to connect to the internal Docker network alias of the Hardhat container       |
| `MaxInFlight`              | 16      | 512                 | Limits the maximum number of unconfirmed transactions allowed in the mempool simultaneously per key                         |
| `MaxQueued`                | 250     | 5000                | Sets the capacity of the internal buffer for transactions waiting to be broadcasted when the `MaxInFlight` limit is reached |
| `ReaperInterval`           | 1h      | 10s                 | Determines the frequency at which the transaction manager checks for confirmed transactions to free up `MaxInFlight` slots  |
| `ResendAfterThreshold`     | 1m      | 10s                 | Specifies the duration the node waits for a transaction confirmation before attempting to re-broadcast (bump) it            |
| `MaxSuccessfulRuns`        | 10000   | 50                  | Sets the retention limit for storing successful pipeline run data in the database before auto-pruning (deletion) occurs     |


## Project Structure

- `contracts/`: Solidity smart contracts (Consumer, Oracle, LinkToken).
- `scripts/`: TypeScript deployment, tracing, and stress-testing scripts.
- `chainlink-config/`: Optimized TOML configurations.
- `docker-compose.yml`: Infrastructure definition.
- `.env`: Contract addresses and jobId

## Troubleshooting

### Port is already in use
This problem is usually caaused by postgres already runnin. To solve it simply run:
sudo systemctl stop postgres

```bash
lsof -i :PORT NUMBER # from this you'll see all the running processes
# look for the PROCESS ID or PID
kill PID
```

### Chainlink node is unresponsive/doesn't register new requests / "RPC endpoint detected out of sync" in chainlink logs
This can happen if the Chainlink Node does not receive *"life signal"* from hardhat

To fix it restart chainlink container:
```bash
docker-compose restart chainlink
```

or everithing:
```bash
docker-compose down -v && docker-compose up -d
```
