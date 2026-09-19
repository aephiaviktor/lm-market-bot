import { PublicKey, Transaction } from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token';

/**
 * Repair ATA instructions created by the Factory SDK for Token-2022 mints.
 *
 * The SDK derives a classic SPL ATA first and also inserts that address into
 * the marketplace instruction. When the mint is Token-2022, changing only the
 * ATA-creation instruction leaves the marketplace instruction pointing at the
 * now-unused classic ATA. Rewrite every reference so both instructions use the
 * same Token-2022 ATA.
 */
export async function normalizeToken2022AtaReferences(
  transaction: Transaction,
  getMintOwner: (mint: PublicKey) => Promise<PublicKey | null>,
  log?: (message: string) => void,
): Promise<number> {
  let changedInstructionCount = 0;

  for (const instruction of transaction.instructions) {
    if (!instruction.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID) || instruction.keys.length < 6) {
      continue;
    }

    const ataKey = instruction.keys[1];
    const owner = instruction.keys[2]?.pubkey;
    const mint = instruction.keys[3]?.pubkey;
    const tokenProgramKey = instruction.keys[5];
    if (!ataKey || !owner || !mint || !tokenProgramKey) {
      continue;
    }

    const mintOwner = await getMintOwner(mint);
    if (!mintOwner?.equals(TOKEN_2022_PROGRAM_ID)) {
      continue;
    }

    const expectedAta = await getAssociatedTokenAddress(
      mint,
      owner,
      true,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    const originalAta = ataKey.pubkey;
    let changed = false;

    if (!originalAta.equals(expectedAta)) {
      for (const targetInstruction of transaction.instructions) {
        for (let keyIndex = 0; keyIndex < targetInstruction.keys.length; keyIndex += 1) {
          const key = targetInstruction.keys[keyIndex];
          if (key.pubkey.equals(originalAta)) {
            targetInstruction.keys[keyIndex] = {
              ...key,
              pubkey: expectedAta,
            };
          }
        }
      }
      changed = true;
    }

    if (!tokenProgramKey.pubkey.equals(TOKEN_2022_PROGRAM_ID)) {
      instruction.keys[5] = {
        ...tokenProgramKey,
        pubkey: TOKEN_2022_PROGRAM_ID,
      };
      changed = true;
    }

    if (changed) {
      changedInstructionCount += 1;
      log?.(`Using Token-2022 ATA ${expectedAta.toBase58()} for ${mint.toBase58()}.`);
    }
  }

  return changedInstructionCount;
}
