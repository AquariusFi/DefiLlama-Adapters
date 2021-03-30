const sdk = require("@defillama/sdk");
const abi = require('./abi.json')
const BigNumber = require("bignumber.js");
const axios = require('axios')
const { unwrapUniswapLPs } = require('../helper/unwrapLPs')

const wbnbInx = '0x898c75e1F9B80AD167403a72717A7Edf2F2Aa28d'
const inx = 'bsc:0xd60D91EAE3E0F46098789fb593C06003253E5D0a'
const wbnb = 'bsc:0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'

function getCallsFromTargets(targets) {
  return targets.map(target => ({
    target
  }))
}

async function tvl(timestamp) {
  const { block } = await sdk.api.util.lookupBlock(timestamp, {
    chain: 'bsc'
  })
  const balances = {};

  const config = (await axios.get('https://api.allinx.io/api/config')).data.data
  const vaults = Object.values(config.vaults).map(({address})=>address)
  const lpStakingPools = Object.values(config.stakepools).filter(pool=>{
    return vaults.indexOf(pool.stakeToken.token.address) === -1
  }).sort((a,b)=>a.name === 'INX'?1:-1).map(({address})=>address)
  const vaultCalls = getCallsFromTargets(vaults)
  const vaultBalances = sdk.api.abi.multiCall({
    abi: abi['balance'],
    calls: vaultCalls,
    block,
    chain: 'bsc'
  })
  const vaultTokens = (await sdk.api.abi.multiCall({
    abi: abi['token'],
    calls: vaultCalls,
    block,
    chain: 'bsc'
  })).output
  const vaultTokenSymbols = (await sdk.api.abi.multiCall({
    abi: "erc20:symbol",
    calls: vaultTokens.map(call => ({
      target: call.output
    })),
    block,
    chain: 'bsc'
  })).output;
  const resolvedVaultBalances = (await vaultBalances).output;

  const lpTokensToCheck = []
  for (let i = 0; i < resolvedVaultBalances.length; i++) {
    if (vaultTokenSymbols[i].output === "Cake-LP") {
      lpTokensToCheck.push({
        token: vaultTokens[i].output,
        balance: resolvedVaultBalances[i].output
      })
    } else {
      sdk.util.sumSingleBalance(balances, `bsc:${vaultTokens[i].output}`, resolvedVaultBalances[i].output)
    }
  }

  const lpTokens = sdk.api.abi.multiCall({
    abi: abi['_lpToken'],
    calls: getCallsFromTargets(lpStakingPools),
    block,
    chain: 'bsc'
  })
  const lpTokenBalances = (await sdk.api.abi.multiCall({
    abi: abi['totalSupply'],
    calls: getCallsFromTargets(lpStakingPools),
    block,
    chain: 'bsc'
  })).output
  const resolvedLpTokens = (await lpTokens).output;
  sdk.util.sumSingleBalance(balances, `bsc:${resolvedLpTokens.pop().output}`, resolvedVaultBalances.pop().output);
  await unwrapUniswapLPs(balances, resolvedLpTokens
    .map((call, i) => ({
      token: call.output,
      balance: lpTokenBalances[i].output
    }))
    .concat(lpTokensToCheck),
    block, 'bsc', addr => `bsc:${addr}`);

  // Convert inx to bnb
  const reservesInxBNB = (await sdk.api.abi.call({
    target: wbnbInx,
    abi: { "constant": true, "inputs": [], "name": "getReserves", "outputs": [{ "internalType": "uint112", "name": "_reserve0", "type": "uint112" }, { "internalType": "uint112", "name": "_reserve1", "type": "uint112" }, { "internalType": "uint32", "name": "_blockTimestampLast", "type": "uint32" }], "payable": false, "stateMutability": "view", "type": "function" },
    block,
    chain: 'bsc'
  })).output;
  const inxAmount = balances[inx];
  delete balances[inx];
  sdk.util.sumSingleBalance(balances, wbnb, BigNumber(reservesInxBNB[0]).div(reservesInxBNB[1]).times(inxAmount).toFixed(0))
  return balances
}

module.exports = {
  name: 'Allinx',
  token: 'INX',
  category: 'yield',
  start: 0, // WRONG!
  tvl
}