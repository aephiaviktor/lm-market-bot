'use strict';

const { Keypair } = require('@solana/web3.js');
const bs58 = require('bs58');

function decodeWalletSecret(secret) {
  const trimmed = String(secret || '').trim();
  if (!trimmed) {
    throw new Error('Hot wallet secret is empty.');
  }

  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) {
      throw new Error('Hot wallet secret JSON value must be an array.');
    }
    return Uint8Array.from(parsed);
  }

  const hexLike = trimmed.startsWith('0x') ? trimmed.slice(2) : trimmed;
  if (/^[0-9a-fA-F]+$/.test(hexLike)) {
    if (hexLike.length % 2 !== 0) {
      throw new Error('Hot wallet secret hex value must have an even length.');
    }
    return Uint8Array.from(Buffer.from(hexLike, 'hex'));
  }

  return (bs58.decode || bs58.default.decode)(trimmed);
}

function getHotWalletAddressFromSecret(secret) {
  return Keypair.fromSecretKey(decodeWalletSecret(secret)).publicKey.toBase58();
}

function getDisplayAccounts(config = {}) {
  const managedWallet = String(config.OWNER_WALLET || '').trim();
  const managedPlayerProfile = String(config.OWNER_PROFILE || '').trim();
  let hotWalletAddress = '';
  let hotWalletError = '';

  if (String(config.HOT_WALLET_SECRET || '').trim()) {
    try {
      hotWalletAddress = getHotWalletAddressFromSecret(config.HOT_WALLET_SECRET);
    } catch (err) {
      hotWalletError = err?.message || String(err);
    }
  }

  return {
    hotWalletAddress,
    hotWalletError,
    managedWallet,
    managedPlayerProfile,
  };
}

module.exports = {
  decodeWalletSecret,
  getDisplayAccounts,
  getHotWalletAddressFromSecret,
};
