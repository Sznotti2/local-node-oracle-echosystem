import fs from "fs";
import path from "path";

/**
 * Updates or adds an environment variable in the .env file
 * @param key env variable to update or create
 * @param value env variables new value
 */
export function updateEnvVariable(key: string, value: string) {
    const envPath = path.join(__dirname, "../.env");
    let envContent = "";
    
    if (fs.existsSync(envPath)) {
        envContent = fs.readFileSync(envPath, "utf-8");
    }

    const regex = new RegExp(`^${key}=.*`, "m");
    if (envContent.match(regex)) {
        envContent = envContent.replace(regex, `${key}=${value}`);
    } else {
        envContent += `\n${key}=${value}`;
    }

    envContent = envContent.replace(/^\s*[\r\n]/gm, '').trim() + "\n"; // remove empty lines for better appearance
    fs.writeFileSync(envPath, envContent);
}

interface EnvVariables {
	LINKTOKEN_ADDRESS?: string;
	OPERATOR_ADDRESS?: string;
	CONSUMER_ADDRESS?: string;
	NODE_ADDRESS: string;
	CHAINLINK_URL: string;
	JOB_ID?: string;
	NUMBER_OF_NODES: number;
	WS_URL: string;
}

/**
 * Helper function to read all necessary environment variables from the .env file and return them in a structured format
 * @returns All environment variables
 */
export function getEnvVariables(): EnvVariables {
	const nodeAddress = process.env.NODE_ADDRESS;
	const chainlinkUrl = process.env.CHAINLINK_URL;
	const jobID = process.env.JOB_ID;
	const linktokenAddress = process.env.LINKTOKEN_ADDRESS;
	const operatorAddress = process.env.OPERATOR_ADDRESS;
	const consumerAddress = process.env.CONSUMER_ADDRESS;
	const wsRpcUrl = process.env.WS_URL;

	if (!nodeAddress || !chainlinkUrl || !wsRpcUrl) {
		console.error("Error: Missing NODE_ADDRESS, CHAINLINK_URL or WS_RPC_URL in the .env file!");
		process.exit(1);
	}

    return {
        NODE_ADDRESS: nodeAddress,
        CHAINLINK_URL: chainlinkUrl,
        JOB_ID: jobID,
        LINKTOKEN_ADDRESS: linktokenAddress,
        OPERATOR_ADDRESS: operatorAddress,
        CONSUMER_ADDRESS: consumerAddress,
		NUMBER_OF_NODES: process.env.NUMBER_OF_NODES ? parseInt(process.env.NUMBER_OF_NODES) : 1,
		WS_URL: wsRpcUrl,
    };
}

interface EnvVariablesDon {
	LINKTOKEN_ADDRESS?: string;
	OPERATOR_ADDRESS?: string;
	CONSUMER_ADDRESS?: string;
	NUMBER_OF_NODES: number;
	CHAINLINK_URLS: string[];
	NODE_ADDRESSES: string[];
	JOB_IDS?: string[];
	WS_URL: string;
}

export function getEnvVariablesDon(): EnvVariablesDon {
	const linktokenAddress = process.env.LINKTOKEN_ADDRESS;
	const operatorAddress = process.env.OPERATOR_ADDRESS;
	const consumerAddress = process.env.CONSUMER_ADDRESS;
	const wsRpcUrl = process.env.WS_URL;

	const numberOfNodes = process.env.NUMBER_OF_NODES ? parseInt(process.env.NUMBER_OF_NODES) : 5;

	if (!wsRpcUrl) {
		console.error("Error: Missing WS_RPC_URL in the .env file!");
		process.exit(1);
	}

	let chainlinkNodeUrls: string[] = [];
	let nodeAddresses: string[] = [];
	let jobIds: string[] = [];

	for (let i=1; i<=numberOfNodes; i++) {
		const chainlinkUrl = process.env[`CHAINLINK_URL_${i}`];
		const nodeAddress = process.env[`NODE_ADDRESS_${i}`];
		const jobId = process.env[`JOB_ID_${i}`];

		if (!chainlinkUrl || !nodeAddress) {
			console.error(`Error: Missing CHAINLINK_URL_${i} or NODE_ADDRESS_${i} in the .env file!`);
			process.exit(1);
		}

		chainlinkNodeUrls.push(chainlinkUrl);
		nodeAddresses.push(nodeAddress);
		if (jobId) jobIds.push(jobId)
	}

	return {
        LINKTOKEN_ADDRESS: linktokenAddress,
        OPERATOR_ADDRESS: operatorAddress,
        CONSUMER_ADDRESS: consumerAddress,
		NUMBER_OF_NODES: numberOfNodes,
		CHAINLINK_URLS: chainlinkNodeUrls,
		NODE_ADDRESSES: nodeAddresses,
		JOB_IDS: jobIds,
		WS_URL: wsRpcUrl,
	}
}

interface NodeCredentials {
	email: string;
	password: string;
}

export function getNodeCredentials(): NodeCredentials {
	const credentialsPath = path.join(__dirname, "../chainlink-config/apicredentials");
	const [email, password] = fs.readFileSync(credentialsPath, "utf-8").split("\n");
	return { email, password };
}
export function getCredentialsOf(nodeId: number): NodeCredentials {
	const credentialsPath = path.join(__dirname, `../nodes/chainlink-config-${nodeId}/apicredentials`);
	const [email, password] = fs.readFileSync(credentialsPath, "utf-8").split("\n");
	return { email, password };
}

export const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

const CITIES = [
    "London", "Paris", "NewYork", "Tokyo", "Sydney",
    "Moscow", "Dubai", "Berlin", "Rome", "Madrid", "Szeged",
];

export function getRandomCity(): string {
    const index = Math.floor(Math.random() * CITIES.length);
    return CITIES[index];
}

export interface RequestData {
    sentTxAt: number;			// time Tx was mined
    createdDetectedAt?: number; // RequestCreated event was caught
    fulfilledAt?: number;		// RequestFulfilled event
    isComplete: boolean;
}

export interface BatchResult {
    count: number;				// num of requests to send in bulk
    successCount: number;
    successRate: number;
    avgWriteLatency: number;	// from sentTxAt to createdDetectedAt
    avgNodeLatency: number;		// from createdDetectedAt to fulfilledAt
    avgTotalLatency: number;	// from sentTxAt to fulfilledAt
    totalDuration: number;		// first function call
    tps: number;				// successCount / totalDuration
    totalRequestCostETH: string;
    totalFulfillmentCostETH: string;
    avgRequestGasPriceGwei: string;
    avgFulfillmentGasPriceGwei: string;
    error?: string;
}
