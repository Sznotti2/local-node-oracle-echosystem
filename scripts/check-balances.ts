import { ethers } from "hardhat";
import { getEnvVariables } from "../utils/helper";


async function main() {
	const { NODE_ADDRESS, CONSUMER_ADDRESS, OPERATOR_ADDRESS, LINKTOKEN_ADDRESS } = getEnvVariables();

	if (!NODE_ADDRESS || !CONSUMER_ADDRESS || !OPERATOR_ADDRESS || !LINKTOKEN_ADDRESS) {
		console.error("Error: One or more environment variables are missing. Please check your .env file.");
		return;
	}

    const linkToken = await ethers.getContractAt("LinkToken", LINKTOKEN_ADDRESS);
    
    const [deployer] = await ethers.getSigners();

    console.log("|------------------------------------------------------------------------------------------------------|");
    console.log(`| ${"Name".padEnd(25)} | ${"Address".padEnd(42)} | ${"ETH (Gas)".padEnd(12)} | ${"LINK".padEnd(12)} |`);
    console.log("|------------------------------------------------------------------------------------------------------|");

    const accounts = [
        { name: "Deployer (Admin)", address: deployer.address },
        { name: "Chainlink Node Wallet", address: NODE_ADDRESS },
        { name: "Consumer Contract", address: CONSUMER_ADDRESS },
        { name: "Operator Contract", address: OPERATOR_ADDRESS },
        { name: "LinkToken Contract", address: LINKTOKEN_ADDRESS }
    ];

    for (const acc of accounts) {
        const ethBalWei = await ethers.provider.getBalance(acc.address);
        const ethBal = ethers.formatEther(ethBalWei);

        let linkBal = "0.0";
        try {
            const linkBalWei = await linkToken.balanceOf(acc.address);
            linkBal = ethers.formatEther(linkBalWei);
        } catch (error) {
            linkBal = "ERR";
        }

        console.log(`| ${acc.name.padEnd(25)} | ${acc.address} | ${parseFloat(ethBal).toFixed(4).padEnd(12)} | ${parseFloat(linkBal).toFixed(4).padEnd(12)} |`);
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });