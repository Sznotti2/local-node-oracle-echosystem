import { ethers } from "hardhat";


async function main() {
    const linkTokenAddr = process.env.LINKTOKEN_ADDRESS;
    const operatorAddr = process.env.OPERATOR_ADDRESS;
    const consumerAddr = process.env.CONSUMER_ADDRESS;
    const nodeWalletAddr = process.env.NODE_WALLET || process.env.CHAINLINK_NODE_ADDRESS;

    if (!linkTokenAddr || !operatorAddr || !consumerAddr || !nodeWalletAddr) {
        console.error("❌ ERROR: Missing environment variables in the .env file!");
        console.log("Required variables:");
        console.log(` - LINKTOKEN_ADDRESS: ${linkTokenAddr || "MISSING"}`);
        console.log(` - OPERATOR_ADDRESS: ${operatorAddr || "MISSING"}`);
        console.log(` - CONSUMER_ADDRESS: ${consumerAddr || "MISSING"}`);
        console.log(` - NODE_WALLET: ${nodeWalletAddr || "MISSING"}`);
        process.exit(1);
    }

    const linkToken = await ethers.getContractAt("LinkToken", linkTokenAddr);
    
    const [deployer] = await ethers.getSigners();

    console.log("|------------------------------------------------------------------------------------------------------|");
    console.log(`| ${"Name".padEnd(25)} | ${"Address".padEnd(42)} | ${"ETH (Gas)".padEnd(12)} | ${"LINK".padEnd(12)} |`);
    console.log("|------------------------------------------------------------------------------------------------------|");

    const accounts = [
        { name: "Deployer (Admin)", address: deployer.address },
        { name: "Chainlink Node Wallet", address: nodeWalletAddr },
        { name: "Consumer Contract", address: consumerAddr },
        { name: "Operator Contract", address: operatorAddr },
        { name: "LinkToken Contract", address: linkTokenAddr }
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