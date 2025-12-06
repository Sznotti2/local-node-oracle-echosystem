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
			// used by "npx hardhat node" command.(server)
			chainId: 31337,
		},
		localhost: {
			// used by the clients to connect to hardhats JSON-RPC server
			chainId: 31337,
			url: process.env.HARDHAT_URL || "http://127.0.0.1:8545", // HARDHAT_URL exposed 
		},
	},
	// defaultNetwork: "localhost",
};

export default config;
