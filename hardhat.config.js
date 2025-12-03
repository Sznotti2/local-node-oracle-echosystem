require("@nomicfoundation/hardhat-toolbox")
require("./tasks")
require("dotenv").config()

const COMPILER_SETTINGS = {
    optimizer: {
        enabled: true,
        runs: 1000000,
    },
    metadata: {
        bytecodeHash: "none",
    },
}

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
    solidity: {
        compilers: [
            {
                version: "0.8.20",
                settings: COMPILER_SETTINGS,
            },
            {
                version: "0.8.19",
                settings: COMPILER_SETTINGS,
            },
            {
                version: "0.8.7",
                settings: COMPILER_SETTINGS,
            },
            {
                version: "0.8.6",
                settings: COMPILER_SETTINGS,
            },
            {
                version: "0.8.0",
                settings: COMPILER_SETTINGS,
            },
            {
                version: "0.6.12",
                settings: {
						optimizer: { enabled: true, runs: 200 }
					},
            },
        ],
    },
    networks: {
        hardhat: {
            // Ez definiálja, hogyan viselkedjen a "npx hardhat node" parancs.(server)
            // ITT NEM LEHET URL!
            chainId: 31337,
        },
        localhost: {
            // Ezt használja a deploy script és a setup container, (kliens)
            // hogy csatlakozzon a fenti node-hoz.
            chainId: 31337,
			url: process.env.HARDHAT_URL || "http://127.0.0.1:8545",
        },
    },
    defaultNetwork: "localhost",
    /*
    gasReporter: {
        enabled: true,
        currency: "USD",
        outputFile: "gas-report.txt",
        noColors: true,
        // coinmarketcap: process.env.COINMARKETCAP_API_KEY,
    },
    contractSizer: {
        runOnCompile: false,
        only: [
            "APIConsumer",
            "AutomationCounter",
            "NFTFloorPriceConsumerV3",
            "PriceConsumerV3",
            "RandomNumberConsumerV2",
            "RandomNumberDirectFundingConsumerV2",
        ],
    },
    paths: {
        sources: "./contracts",
        tests: "./test",
        cache: "./build/cache",
        artifacts: "./build/artifacts",
    },
    mocha: {
        timeout: 300000, // 300 seconds max for running tests
    },
    */

}
