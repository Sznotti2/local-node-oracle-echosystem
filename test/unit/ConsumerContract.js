const { network, ethers } = require("hardhat")
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers")
const { networkConfig, developmentChains } = require("../../helper-hardhat-config")
const { assert, expect } = require("chai")

!developmentChains.includes(network.name)
    ? describe.skip
    : describe("Consumer Contract Unit Tests", function () {
        async function deployConsumerContractFixture() {
            const [owner, purchaser, beneficiary, other] = await ethers.getSigners()
            const ConsumerContractFactory = await ethers.getContractFactory("ConsumerContract")
            const consumerContract = await ConsumerContractFactory.deploy(owner.address, owner.address)
            return { consumerContract, owner, purchaser, beneficiary, other }
        }

        async function buyPolicy(consumerContract, purchaser, beneficiary, overrides = {}) {
            const {
                location = "Szeged",
                duration = 24 * 60 * 60,
                threshold = 30,
                payout = ethers.utils.parseEther("2"),
                premium = ethers.utils.parseEther("1"),
            } = overrides
            const tx = await consumerContract
                .connect(purchaser)
                .buyPolicy(location, duration, threshold, beneficiary.address, payout, { value: premium })
            const receipt = await tx.wait()
            const purchaseEvent = receipt.events.find((event) => event.event === "PolicyPurchased")
            const policyId = purchaseEvent.args.policyId
            return { policyId, location, duration, threshold, payout, premium }
        }

        describe("#buyPolicy", function () {
            it("stores policy details and premium", async function () {
                const { consumerContract, purchaser, beneficiary } = await loadFixture(deployConsumerContractFixture)
                const { policyId, duration, threshold, payout, premium } = await buyPolicy(
                    consumerContract,
                    purchaser,
                    beneficiary
                )

                const stored = await consumerContract.getPolicy(policyId)
                expect(stored.purchaser).to.equal(purchaser.address)
                expect(stored.beneficiary).to.equal(beneficiary.address)
                expect(stored.duration).to.equal(duration)
                expect(stored.threshold).to.equal(ethers.BigNumber.from(threshold).mul(100))
                expect(stored.payout).to.equal(payout)
                expect(stored.premium).to.equal(premium)
                expect(stored.active).to.equal(true)
                expect(stored.paid).to.equal(false)
            })
        })

        describe("Insurance evaluation flow", function () {
            it("pays out when temperature is higher than threshold", async function () {
                const { consumerContract, owner, purchaser, beneficiary } = await loadFixture(deployConsumerContractFixture)
                const { policyId } = await buyPolicy(consumerContract, purchaser, beneficiary, {
                    payout: ethers.utils.parseEther("2"),
                    premium: ethers.utils.parseEther("1"),
                })
				await owner.sendTransaction({ to: consumerContract.address, value: ethers.utils.parseEther("2") })

                const policy = await consumerContract.getPolicy(policyId)
                const recordedTemp = 3100 // threshold is 30.00 C
                const contractBefore = await ethers.provider.getBalance(consumerContract.address)
                const beneficiaryBefore = await ethers.provider.getBalance(beneficiary.address)

                await expect(
                    consumerContract.connect(owner).evaluatePoliciesForTest("Szeged", recordedTemp)
                ).to.emit(consumerContract, "PolicyPayout").withArgs(policyId, beneficiary.address, policy.payout)

                const contractAfter = await ethers.provider.getBalance(consumerContract.address)
                const beneficiaryAfter = await ethers.provider.getBalance(beneficiary.address)
                expect(contractAfter).to.equal(contractBefore.sub(policy.payout))
                expect(beneficiaryAfter.sub(beneficiaryBefore)).to.equal(policy.payout)

                const updated = await consumerContract.getPolicy(policyId)
                expect(updated.active).to.equal(false)
                expect(updated.paid).to.equal(true)
            })

            it("emits NotEnoughBalance when funds are insufficient", async function () {
                const { consumerContract, owner, purchaser, beneficiary } = await loadFixture(deployConsumerContractFixture)
                const payout = ethers.utils.parseEther("100001")
                const premium = ethers.utils.parseEther("0.1")
                const { policyId } = await buyPolicy(consumerContract, purchaser, beneficiary, { payout, premium })
                const policy = await consumerContract.getPolicy(policyId)
                const recordedTemp = policy.threshold.sub(100)
                const contractBefore = await ethers.provider.getBalance(consumerContract.address)
                const beneficiaryBefore = await ethers.provider.getBalance(beneficiary.address)
                
                await expect(
                    consumerContract.connect(owner).evaluatePoliciesForTest("Szeged", recordedTemp)
                ).to.emit(consumerContract, "NotEnoughBalance").withArgs(contractBefore, beneficiary.address, payout)

                const updated = await consumerContract.getPolicy(policyId)
                expect(updated.active).to.equal(false)
                expect(updated.paid).to.equal(false)
                expect(await ethers.provider.getBalance(consumerContract.address)).to.equal(contractBefore)
                expect(await ethers.provider.getBalance(beneficiary.address)).to.equal(beneficiaryBefore)
            })

            it("expires policy after duration lapses", async function () {
                const { consumerContract, owner, purchaser, beneficiary } = await loadFixture(deployConsumerContractFixture)
                const duration = 1
                const { policyId } = await buyPolicy(consumerContract, purchaser, beneficiary, {
                    duration,
                    premium: ethers.utils.parseEther("1"),
                    payout: ethers.utils.parseEther("0.5"),
                })
                const policy = await consumerContract.getPolicy(policyId)
                const recordedTemp = policy.threshold.sub(100)

                await time.increase(duration + 1)

                await expect(
                    consumerContract.connect(owner).evaluatePoliciesForTest("Szeged", recordedTemp)
                ).to.emit(consumerContract, "PolicyExpired").withArgs(policyId)

                const updated = await consumerContract.getPolicy(policyId)
                expect(updated.active).to.equal(false)
                expect(updated.paid).to.equal(false)
                expect(await ethers.provider.getBalance(consumerContract.address)).to.equal(policy.premium)
            })
        })

        describe("Policy management", function () {
            it("allows purchaser to cancel and receive premium back", async function () {
                const { consumerContract, purchaser, beneficiary, other } = await loadFixture(deployConsumerContractFixture)
                const premium = ethers.utils.parseEther("0.25")
                const { policyId } = await buyPolicy(consumerContract, purchaser, beneficiary, {
                    premium,
                    payout: ethers.utils.parseEther("0.5"),
                })

                await expect(consumerContract.connect(other).cancelPolicy(policyId)).to.be.revertedWith(
                    "only the purchaser can cancel"
                )

                await expect(consumerContract.connect(purchaser).cancelPolicy(policyId)).to.not.be.reverted
                const updated = await consumerContract.getPolicy(policyId)
                expect(updated.active).to.equal(false)
                expect(updated.premium).to.equal(0)
                expect(await ethers.provider.getBalance(consumerContract.address)).to.equal(0)
            })

            it("allows owner to refund policy and prevents non-owners", async function () {
                const { consumerContract, owner, purchaser, beneficiary } = await loadFixture(deployConsumerContractFixture)
                const premium = ethers.utils.parseEther("0.3")
                const { policyId } = await buyPolicy(consumerContract, purchaser, beneficiary, {
                    premium,
                    payout: ethers.utils.parseEther("0.4"),
                })

                await expect(consumerContract.connect(purchaser).refundPolicy(policyId)).to.be.revertedWith(
                    "Only callable by owner"
                )

                await consumerContract.connect(owner).refundPolicy(policyId)
                const updated = await consumerContract.getPolicy(policyId)
                expect(updated.active).to.equal(false)
                expect(updated.premium).to.equal(0)
                expect(await ethers.provider.getBalance(consumerContract.address)).to.equal(0)
            })
        })
    })
