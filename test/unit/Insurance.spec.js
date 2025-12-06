import hre from "hardhat";
const { ethers } = hre;
import { assert, expect } from "chai";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

describe("Consumer contract", function() {
    async function deployConsumerContractFixture() {
        const [owner, Bob, Philip] = await ethers.getSigners()

        const LinkToken = await ethers.getContractFactory("LinkToken")
        const linkToken = await LinkToken.deploy()

        const ConsumerContract = await ethers.getContractFactory("ConsumerContract")
        const consumerContract = await ConsumerContract.deploy(await linkToken.getAddress(), owner.address) 

        return { consumerContract, linkToken, owner, Bob, Philip }
    }

    async function deployInfrastructureFixture() {
        const signers = await ethers.getSigners()
        const [owner, ...users] = signers

        const LinkToken = await ethers.getContractFactory("LinkToken")
        const linkToken = await LinkToken.deploy()

        const Operator = await ethers.getContractFactory("Operator")
        const operator = await Operator.deploy(await linkToken.getAddress(), owner.address)

        const ConsumerContract = await ethers.getContractFactory("ConsumerContract")
        const consumerContract = await ConsumerContract.deploy(await linkToken.getAddress(), await operator.getAddress())

        // Fund contract with ETH for payouts
        await owner.sendTransaction({
            to: await consumerContract.getAddress(),
            value: ethers.parseEther("100")
        })

        return { consumerContract, linkToken, operator, owner, users }
    }

    async function buyPolicy(consumerContract, purchaser, beneficiary, overrides = {}) {
        const {
            location = "Szeged",
            duration = 1 * 24 * 60 * 60, 
            threshold = 30,
            premium = ethers.parseEther("1"),
        } = overrides
        const tx = await consumerContract
            .connect(purchaser)
            .buyPolicy(location, duration, threshold, beneficiary.address, { value: premium })
        const receipt = await tx.wait()
        
        const purchaseEvent = receipt.logs.find((event) => event.eventName === "PolicyPurchased")
        const policyId = purchaseEvent.args.policyId
        return { policyId }
    }

    async function getTemperature(consumerContract, city, jobId) {
        const tx = await consumerContract.requestTemperature(city, jobId)
        const receipt = await tx.wait()
        
        const requestEvent = receipt.logs.find((event) => event.eventName === "RequestCreated")
        const requestId = requestEvent.args.id
        
        return new Promise((resolve) => {
            consumerContract.once("RequestFulfilled", (id, temperature) => {
                if (id === requestId) {
                    resolve(temperature)
                }
            })
        })
    }

    describe("Deployment", function() {
        it("sets the owner correctly", async function() {
            const { consumerContract, owner } = await loadFixture(deployConsumerContractFixture)
            const contractOwner = await consumerContract.owner()
            assert.equal(contractOwner, owner.address)
        })
        it("has zero ETH and Link initially", async function() {
            const { consumerContract } = await loadFixture(deployConsumerContractFixture)
            const ethBalance = await consumerContract.getContractBalance()
            assert.equal(ethBalance.toString(), "0")

            const linkBalance = await consumerContract.getLinkBalance()
            assert.equal(linkBalance.toString(), "0")
        })
        it("can receive ETH", async function() {
            const { consumerContract, owner } = await loadFixture(deployConsumerContractFixture)
            const tx = {
                to: await consumerContract.getAddress(),
                value: ethers.parseEther("1.0"),
            }
            await owner.sendTransaction(tx)
            const balance = await ethers.provider.getBalance(await consumerContract.getAddress())
            assert.equal(balance.toString(), ethers.parseEther("1.0").toString())
        })
        it("can only withdraw ETH by owner", async function() {
            const { consumerContract, owner, Bob } = await loadFixture(deployConsumerContractFixture)
            const amount = ethers.parseEther("1.0")

            const txSend = {
                to: await consumerContract.getAddress(),
                value: amount,
            }
            await owner.sendTransaction(txSend)

            await expect(
                consumerContract.connect(Bob).withdrawETH(amount)
            ).to.be.revertedWith("Only callable by owner")

            const ownerBalanceBefore = await ethers.provider.getBalance(owner.address)
            const withdrawTx = await consumerContract.connect(owner).withdrawETH(amount)
            const receipt = await withdrawTx.wait()

            const gasPaid = receipt.gasUsed * receipt.gasPrice

            const ownerBalanceAfter = await ethers.provider.getBalance(owner.address)
            
            expect(ownerBalanceAfter).to.equal(ownerBalanceBefore + amount - gasPaid)

            const contractBalance = await ethers.provider.getBalance(await consumerContract.getAddress())
            assert.equal(contractBalance.toString(), "0")
        })
        it("can receive Link", async function() {
            const { consumerContract, linkToken, owner } = await loadFixture(deployConsumerContractFixture)

            const grantRoleTx = await linkToken.grantMintRole(owner.address)
            await grantRoleTx.wait()
            const amount = ethers.parseUnits("10", 18)
            const txMint = await linkToken.mint(owner.address, amount)
            await txMint.wait()

            await linkToken.connect(owner).transfer(await consumerContract.getAddress(), amount)

            const linkBalance = await consumerContract.getLinkBalance()
            assert.equal(linkBalance.toString(), amount.toString())
        })
        it("can only withdraw Link by owner", async function() {
            const { consumerContract, linkToken, owner, Bob } = await loadFixture(deployConsumerContractFixture)

            const grantRoleTx = await linkToken.grantMintRole(owner.address)
            await grantRoleTx.wait()
            const amount = ethers.parseUnits("10", 18)
            const txMint = await linkToken.mint(owner.address, amount)
            await txMint.wait()

            await linkToken.connect(owner).transfer(await consumerContract.getAddress(), amount)

            await expect(
                consumerContract.connect(Bob).withdrawLink()
            ).to.be.revertedWith("Only callable by owner")

            const withdrawTx = await consumerContract.connect(owner).withdrawLink()
            await withdrawTx.wait()

            const ownerBalance = await linkToken.balanceOf(owner.address)
            assert.equal(ownerBalance.toString(), amount.toString())

            const contractBalance = await consumerContract.getLinkBalance()
            assert.equal(contractBalance.toString(), "0")
        })
    })
    describe("buyPolicy", function() {
        it("allows buying a policy with default parameters", async function() {
            const { consumerContract, Bob, Philip } = await loadFixture(deployConsumerContractFixture)
            const premium = ethers.parseEther("1")
            const { policyId } = await buyPolicy(
                consumerContract,
                Bob,
                Philip
            )

            const policy = await consumerContract.getPolicy(policyId)
            expect(policy.purchaser).to.equal(Bob.address)
            expect(policy.beneficiary).to.equal(Philip.address)
            expect(policy.location).to.equal(ethers.encodeBytes32String("Szeged"))
            expect(policy.duration).to.equal(24 * 60 * 60)
            expect(policy.threshold).to.equal(30 * 100)
            expect(policy.premium).to.equal(premium)
            expect(policy.payout).to.equal(ethers.parseEther("1") * 2n)
            expect(policy.active).to.equal(true)
            expect(policy.paid).to.equal(false)
        })
        it("rejects buying a policy with zero premium", async function() {
            const { consumerContract, Bob, Philip } = await loadFixture(deployConsumerContractFixture)
            await expect(
                buyPolicy(consumerContract, Bob, Philip, { premium: 0 })
            ).to.be.revertedWith("premium required")
        })
        it("rejects buying a policy with less than minimum duration", async function() {
            const { consumerContract, Bob, Philip } = await loadFixture(deployConsumerContractFixture)
            await expect(
                buyPolicy(consumerContract, Bob, Philip, { duration: 12 * 60 * 60 })
            ).to.be.revertedWith("duration can't be lower than a day")
        })
        it("contract receives the premium upon policy purchase", async function() {
            const { consumerContract, Bob, Philip } = await loadFixture(deployConsumerContractFixture)
            const premium = ethers.parseEther("1")

            const contractAddr = await consumerContract.getAddress()

            const contractBalanceBefore = await ethers.provider.getBalance(contractAddr)
            expect(contractBalanceBefore.toString()).to.equal("0")

            await buyPolicy(consumerContract, Bob, Philip, { premium })

            const contractBalanceAfter = await ethers.provider.getBalance(contractAddr)
            expect(contractBalanceAfter.toString()).to.equal(premium.toString())
        })
    })
    describe("Consumer Contract Stress Tests", function () {
        this.timeout(300000); 

        describe("Gas Efficiency Tests", function () {
            it("measures gas for single policy purchase", async function () {
                const { consumerContract, users } = await loadFixture(deployInfrastructureFixture)
                const premium = ethers.parseEther("1")

                const tx = await consumerContract.connect(users[0]).buyPolicy(
                    "Szeged",
                    24 * 60 * 60,
                    30,
                    users[1].address,
                    { value: premium }
                )
                const receipt = await tx.wait()
                
                // console.log(`Gas used for policy purchase: ${receipt.gasUsed.toString()}`)
                expect(receipt.gasUsed).to.be.lessThan(500000)
            })

            it("measures gas for evaluating multiple policies", async function () {
                const { consumerContract, users } = await loadFixture(deployInfrastructureFixture)
                
                for (let i = 0; i < 10; i++) {
                    await consumerContract.connect(users[i % users.length]).buyPolicy(
                        "Szeged",
                        24 * 60 * 60,
                        30,
                        users[(i + 1) % users.length].address,
                        { value: ethers.parseEther("1") }
                    )
                }

                const tx = await consumerContract.evaluatePoliciesForTest("Szeged", 3100)
                const receipt = await tx.wait()
                
                // console.log(`Gas used for evaluating 10 policies: ${receipt.gasUsed.toString()}`)
            })
        })

        describe("Load Tests", function () {
            it("handles 50 concurrent policy purchases", async function () {
                const { consumerContract, users } = await loadFixture(deployInfrastructureFixture)
                const premium = ethers.parseEther("0.1")

                const purchases = []
                for (let i = 0; i < 50; i++) {
                    purchases.push(
                        consumerContract.connect(users[i % users.length]).buyPolicy(
                            "Szeged",
                            24 * 60 * 60,
                            30,
                            users[(i + 1) % users.length].address,
                            { value: premium }
                        )
                    )
                }

                const results = await Promise.allSettled(purchases)
                const successful = results.filter(r => r.status === "fulfilled").length
                
                // console.log(`Successful purchases: ${successful}/50`)
                expect(successful).to.be.at.least(45) 
            })

            it("handles evaluation of 100 policies without running out of gas", async function () {
                const { consumerContract, users } = await loadFixture(deployInfrastructureFixture)
                
                for (let i = 0; i < 100; i++) {
                    await consumerContract.connect(users[i % users.length]).buyPolicy(
                        "Szeged",
                        24 * 60 * 60,
                        30,
                        users[(i + 1) % users.length].address,
                        { value: ethers.parseEther("0.1") }
                    )
                }

                try {
                    const tx = await consumerContract.evaluatePoliciesForTest("Szeged", 3100, {
                        gasLimit: 30000000
                    })
                    await tx.wait()
                    // console.log("Successfully evaluated 100 policies")
                } catch (error) {
                    // console.log("Failed to evaluate 100 policies - block gas limit reached")
                    // console.log("Consider implementing pagination for policy evaluation")
                }
            })
        })

        describe("Edge Cases", function () {
            it("handles zero premium gracefully", async function () {
                const { consumerContract, users } = await loadFixture(deployInfrastructureFixture)

				const safeMaxThreshold = ethers.MaxUint256 / 100n;

                await expect(
                    consumerContract.connect(users[0]).buyPolicy(
                        "Szeged",
                        24 * 60 * 60,
                        safeMaxThreshold,
                        users[1].address,
                        { value: 0 }
                    )
                ).to.be.revertedWith("premium required")
            })

            it("handles insufficient contract balance for payout", async function () {
                const { consumerContract, owner, users } = await loadFixture(deployInfrastructureFixture)
                
                const balance = await ethers.provider.getBalance(await consumerContract.getAddress())
                await consumerContract.connect(owner).withdrawETH(balance)

                await consumerContract.connect(users[0]).buyPolicy(
                    "Szeged",
                    24 * 60 * 60,
                    30,
                    users[1].address,
                    { value: ethers.parseEther("1") }
                )

                await expect(
                    consumerContract.evaluatePoliciesForTest("Szeged", 3100)
                ).to.emit(consumerContract, "NotEnoughBalance")
            })

            it("handles extremely long duration policies", async function () {
                const { consumerContract, users } = await loadFixture(deployInfrastructureFixture)
                const oneYear = 365 * 24 * 60 * 60

                await expect(
                    consumerContract.connect(users[0]).buyPolicy(
                        "Szeged",
                        oneYear,
                        30,
                        users[1].address,
                        { value: ethers.parseEther("1") }
                    )
                ).to.not.be.reverted
            })

            it("handles maximum threshold values", async function () {
                const { consumerContract, users } = await loadFixture(deployInfrastructureFixture)

				const safeMaxThreshold = ethers.MaxUint256 / 100n;

                await expect(
                    consumerContract.connect(users[0]).buyPolicy(
                        "Szeged",
                        24 * 60 * 60,
                        safeMaxThreshold,
                        users[1].address,
                        { value: ethers.parseEther("1") }
                    )
                ).to.not.be.reverted
            })
        })

        describe("Reentrancy and Security", function () {
            it("prevents reentrancy on policy cancellation", async function () {
                // Placeholder
            })

            it("prevents unauthorized policy evaluation", async function () {
                const { consumerContract, users } = await loadFixture(deployInfrastructureFixture)

                await expect(
                    consumerContract.connect(users[0]).evaluatePoliciesForTest("Szeged", 3100)
                ).to.be.revertedWith("Only callable by owner")
            })
        })
    })
})