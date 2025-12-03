import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "dotenv/config";

const COMPILER_SETTINGS = {
    optimizer: {
        enabled: true,
        runs: 1000000,
    },
    metadata: {
        bytecodeHash: "none",
    },
}

const config: HardhatUserConfig = {
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
		]
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
};

export default config;
