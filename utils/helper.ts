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
	NODE_ADDRESS?: string;
	JOB_ID?:string;
	LINKTOKEN_ADDRESS?: string;
	OPERATOR_ADDRESS?: string;
	CONSUMER_ADDRESS?: string;
	CHAINLINK_URL?: string;
}

export function getEnvVariables(): EnvVariables {
    return {
        NODE_ADDRESS: process.env.NODE_ADDRESS,
        CHAINLINK_URL: process.env.CHAINLINK_URL,
        JOB_ID: process.env.JOB_ID,
        LINKTOKEN_ADDRESS: process.env.LINKTOKEN_ADDRESS,
        OPERATOR_ADDRESS: process.env.OPERATOR_ADDRESS,
        CONSUMER_ADDRESS: process.env.CONSUMER_ADDRESS,
    };
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
    avgTotalLatency: number;
    effectiveDuration: number;
    tps: number;
    totalRequestCostETH: string;
    totalFulfillmentCostETH: string;
    error?: string;
}