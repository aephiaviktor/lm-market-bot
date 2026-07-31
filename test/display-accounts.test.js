'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Keypair } = require('@solana/web3.js');

const {
  getDisplayAccounts,
  getHotWalletAddressFromSecret,
} = require('../electron/display-accounts');

test('display accounts derive only the public hot-wallet address from the decrypted config', () => {
  const wallet = Keypair.generate();
  const hotWalletSecret = JSON.stringify(Array.from(wallet.secretKey));

  const displayAccounts = getDisplayAccounts({
    HOT_WALLET_SECRET: hotWalletSecret,
    OWNER_WALLET: 'managed-wallet',
    OWNER_PROFILE: 'managed-profile',
  });

  assert.equal(displayAccounts.hotWalletAddress, wallet.publicKey.toBase58());
  assert.equal(displayAccounts.hotWalletError, '');
  assert.equal(displayAccounts.managedWallet, 'managed-wallet');
  assert.equal(displayAccounts.managedPlayerProfile, 'managed-profile');
  assert.doesNotMatch(JSON.stringify(displayAccounts), /\[/);
});

test('display accounts report invalid stored secrets without exposing secret text', () => {
  const displayAccounts = getDisplayAccounts({ HOT_WALLET_SECRET: 'not-a-real-secret' });

  assert.equal(displayAccounts.hotWalletAddress, '');
  assert.match(displayAccounts.hotWalletError, /Non-base58 character|bad secret key size|Expected/);
  assert.doesNotMatch(JSON.stringify(displayAccounts), /not-a-real-secret/);
});

test('hot wallet address derivation supports the same secret format as renderer lookup', () => {
  const wallet = Keypair.generate();
  const hotWalletSecret = JSON.stringify(Array.from(wallet.secretKey));

  assert.equal(getHotWalletAddressFromSecret(hotWalletSecret), wallet.publicKey.toBase58());
});
