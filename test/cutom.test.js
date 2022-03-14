const hre = require('hardhat')
const { ethers, waffle } = hre
const { loadFixture } = waffle
const { expect } = require('chai')
const { utils } = ethers

const Utxo = require('../src/utxo')
const { transaction, registerAndTransact, prepareTransaction, buildMerkleTree } = require('../src/index')
const { poseidonHash2, toFixedHex } = require('../src/utils')
const { Keypair } = require('../src/keypair')

const MERKLE_TREE_HEIGHT = 5
const l1ChainId = 1
const MINIMUM_WITHDRAWAL_AMOUNT = utils.parseEther(process.env.MINIMUM_WITHDRAWAL_AMOUNT || '0.01')
const MAXIMUM_DEPOSIT_AMOUNT = utils.parseEther(process.env.MAXIMUM_DEPOSIT_AMOUNT || '1')
const MerkleTree = require('fixed-merkle-tree')

describe('MerkleTreeWithHistory', function () {
  this.timeout(20000)

  async function deploy(contractName, ...args) {
    const Factory = await ethers.getContractFactory(contractName)
    const instance = await Factory.deploy(...args)
    return instance.deployed()
  }

  function getNewTree() {
    return new MerkleTree(MERKLE_TREE_HEIGHT, [], { hashFunction: poseidonHash2 })
  }

  async function fixture() {
    require('../scripts/compileHasher')
    const hasher = await deploy('Hasher')
    const merkleTreeWithHistory = await deploy(
      'MerkleTreeWithHistoryMock',
      MERKLE_TREE_HEIGHT,
      hasher.address,
    )
    await merkleTreeWithHistory.initialize()
    return { hasher, merkleTreeWithHistory }
  }


  async function fixture2() {
    require('../scripts/compileHasher')
    const [sender, gov, l1Unwrapper, multisig] = await ethers.getSigners()
    const verifier2 = await deploy('Verifier2')
    const verifier16 = await deploy('Verifier16')
    const hasher = await deploy('Hasher')

    const token = await deploy('PermittableToken', 'Wrapped ETH', 'WETH', 18, l1ChainId)
    await token.mint(sender.address, utils.parseEther('10000'))

    const amb = await deploy('MockAMB', gov.address, l1ChainId)
    const omniBridge = await deploy('MockOmniBridge', amb.address)

    /** @type {TornadoPool} */
    const tornadoPoolImpl = await deploy(
      'TornadoPool',
      verifier2.address,
      verifier16.address,
      MERKLE_TREE_HEIGHT,
      hasher.address,
      token.address,
      omniBridge.address,
      l1Unwrapper.address,
      gov.address,
      l1ChainId,
      multisig.address,
    )

    const { data } = await tornadoPoolImpl.populateTransaction.initialize(
      MINIMUM_WITHDRAWAL_AMOUNT,
      MAXIMUM_DEPOSIT_AMOUNT,
    )
    const proxy = await deploy(
      'CrossChainUpgradeableProxy',
      tornadoPoolImpl.address,
      gov.address,
      data,
      amb.address,
      l1ChainId,
    )

    const tornadoPool = tornadoPoolImpl.attach(proxy.address)

    await token.approve(tornadoPool.address, utils.parseEther('10000'))

    return { tornadoPool, token, proxy, omniBridge, amb, gov, multisig }
  }


  describe('constantinp2022 custom test', () => {
    it('Just an it function by constantinp2022', async () => {

    // insert a pair of leaves to MerkleTreeWithHistory
      const { merkleTreeWithHistory } = await loadFixture(fixture)
      const { tornadoPool, token } = await loadFixture(fixture2)
    //   const tree = getNewTree()
    //   merkleTreeWithHistory.insert(toFixedHex(123), toFixedHex(456))
    //   tree.bulkInsert([123, 456])
    //   expect(tree.root()).to.be.be.equal(await merkleTreeWithHistory.getLastRoot())

    // Estimate Gas
      const gas = await merkleTreeWithHistory.estimateGas.insert(toFixedHex(123), toFixedHex(456))
      console.log('hasher gas', gas - 21000)

    // Save local address keypair
    const localKeypair = new Keypair() // contains private and public keys
    const localAddress = localKeypair.address() // contains only public key
      
    // Deposit 0.08 ether
        const localDepositAmount = utils.parseEther('0.08')
        const localDepositUtxo = new Utxo({ amount: localDepositAmount })
        await transaction({ tornadoPool, outputs: [localDepositUtxo] })

    
    //  Withdraws 0.05 ETH
        const localWithdrawAmount = utils.parseEther('0.05')
        const recipient = '0xDeaD00000000000000000000000000000000BEEf'
        const localChangeUtxo = new Utxo({ amount: localWithdrawAmount, keypair: localKeypair })
        await transaction({
        tornadoPool,
        inputs: [localDepositUtxo],
        outputs: [localChangeUtxo],
        recipient: recipient,
        isL1Withdrawal: false,
        })

        const balanceCoin = await token.balanceOf(recipient)
        expect(balanceCoin).to.be.equal(localDepositAmount.sub(localWithdrawAmount))
    })
  })

})
