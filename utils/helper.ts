import * as fs from "fs";
import * as path from "path";

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

	if (!nodeAddress || !chainlinkUrl) {
		console.error("Error: Missing NODE_ADDRESS or CHAINLINK_URL in the .env file!");
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
}

export function getEnvVariablesDon(): EnvVariablesDon {
	const linktokenAddress = process.env.LINKTOKEN_ADDRESS;
	const operatorAddress = process.env.OPERATOR_ADDRESS;
	const consumerAddress = process.env.CONSUMER_ADDRESS;

	const numberOfNodes = process.env.NUMBER_OF_NODES ? parseInt(process.env.NUMBER_OF_NODES) : 5;

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




const CITIES = [
    "London", "Paris", "NewYork", "Tokyo", "Sydney",
    "Moscow", "Dubai", "Berlin", "Rome", "Madrid", "Szeged",
];

export function getRandomCity(): string {
    const index = Math.floor(Math.random() * CITIES.length);
    return CITIES[index];
}

export interface RequestData {
    sendTime: number;
    createdTime?: number;
    fulfilledTime?: number;
    isComplete: boolean;
}

export interface BatchResult {
    count: number;
    successCount: number;
    successRate: number;
    avgNodeLatency: number;
    avgLatency: number;
    duration: number;
    tps: number;
    totalRequestCostETH: string;
    totalFulfillmentCostETH: string;
    error?: string;
}