'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PublicKey, Transaction, TransactionInstruction } = require('@solana/web3.js');
const {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} = require('@solana/spl-token');
const { normalizeToken2022AtaReferences } = require('../dist/token-account-policy');

test('Token-2022 ATA normalization rewrites later instruction account references', async () => {
  const payer = new PublicKey('11111111111111111111111111111111');
  const owner = new PublicKey('85BbUrMbPGDekp8mfSznWaSujHKaHrSgsTmiRfVr62Bo');
  const mint = new PublicKey('HYDR4EPHJcDPcaLYUcNCtrXUdt1PnaN4MvE655pevBYp');
  const classicAta = getAssociatedTokenAddressSync(
    mint,
    owner,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const token2022Ata = getAssociatedTokenAddressSync(
    mint,
    owner,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  const createAta = createAssociatedTokenAccountInstruction(
    payer,
    classicAta,
    owner,
    mint,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const initializeLocalBuy = new TransactionInstruction({
    programId: new PublicKey('traderDnaR5w6Tcoi3NFm53i48FTDNbGjBSZwWXDRrg'),
    keys: [{ pubkey: classicAta, isSigner: false, isWritable: true }],
    data: Buffer.alloc(0),
  });
  const transaction = new Transaction().add(createAta, initializeLocalBuy);

  await normalizeToken2022AtaReferences(
    transaction,
    async () => TOKEN_2022_PROGRAM_ID,
  );

  assert.equal(transaction.instructions[0].keys[1].pubkey.toBase58(), token2022Ata.toBase58());
  assert.equal(transaction.instructions[0].keys[5].pubkey.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58());
  assert.equal(transaction.instructions[1].keys[0].pubkey.toBase58(), token2022Ata.toBase58());
});
