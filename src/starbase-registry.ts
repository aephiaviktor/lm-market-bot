export type StarbaseFaction = 'MUD' | 'ONI' | 'USTUR';

export type StarbaseRegistryEntry = {
  name: string;
  publicKey: string;
  faction: StarbaseFaction;
};

export const STARBASE_REGISTRY: StarbaseRegistryEntry[] = [
  { name: 'MUD-1', publicKey: '8Hr93jyQUiZfa4CQQiJ48CAZbotcUYWPMBVzzYb49nss', faction: 'MUD' },
  { name: 'MUD-2', publicKey: '7zomNZp3Z1sjAhNqrvPoWcmshXFHGgUu7FLJrqQtUNkG', faction: 'MUD' },
  { name: 'MUD-3', publicKey: '6pkHA9CPF6xm49TLVN9iJuHn5QF7V2kMvpBFyJBWsHrn', faction: 'MUD' },
  { name: 'MUD-4', publicKey: 'NxvHJR6dQz8KB7WRdwQnHVJphqQ7FEat7VW3rsg5qiY', faction: 'MUD' },
  { name: 'MUD-5', publicKey: 'HVh1yZFxpSXwtrguy8CNHtBQc91uC51xCqYuTAVj64N7', faction: 'MUD' },
  { name: 'ONI-1', publicKey: '5LVVJEAYEQPMoKp45r7GfNcnNDro1oFDgnLo7XHha3Xp', faction: 'ONI' },
  { name: 'ONI-2', publicKey: 'C4gwAfZX2itwyLQGjHQmM5ZEEbvJ73VdMYRARMggHTfX', faction: 'ONI' },
  { name: 'ONI-3', publicKey: 'EtepVfgCfyKAJg4B9QYG5BeSW3oRzMsKPHz7Ld1Hsa5V', faction: 'ONI' },
  { name: 'ONI-4', publicKey: 'GE7Ud3sT16M1NC7xW9YYzSB9dnPWvExgWAZYzxshwgim', faction: 'ONI' },
  { name: 'ONI-5', publicKey: 'EcL56x62fJ4dWiDJSRwSmhgWjTEz73JKSwXybPDh35ME', faction: 'ONI' },
  { name: 'UST-1', publicKey: '94LdKdSHuG3Na6H1YhkgJsq1caYVxUNeBRm7rLB6hd8k', faction: 'USTUR' },
  { name: 'UST-2', publicKey: 'D8KcjKhELZPwhJcamfqnpAnUe5LcTXV3sFwuQeaFK8Es', faction: 'USTUR' },
  { name: 'UST-3', publicKey: '2jijEHvJasRvTJLV9uXyWY9MxaqHQgfU42JQTyStBTe7', faction: 'USTUR' },
  { name: 'UST-4', publicKey: 'ATEHz1f1HzDpEeuSaxYzmSrARqg3txpoQCwHB2kjA8kY', faction: 'USTUR' },
  { name: 'UST-5', publicKey: 'G66MYx8sREyEvFoGPHNHN5bXpTovBETaN2A2dSWfQit3', faction: 'USTUR' },
  { name: 'MRZ-1', publicKey: '98E4PDEwAYFCNcdbt5EL7JYMj5Rqpd4BkMRsDuYBaytF', faction: 'MUD' },
  { name: 'MRZ-2', publicKey: '13wRULPgbZrL9H6W3ov5uvRza3PVtDxegfNzSPCymuEu', faction: 'MUD' },
  { name: 'MRZ-3', publicKey: '5wvPB4CWed1abXqYH3QCRpt8mZQjrD1wqRcxXGtY1psx', faction: 'MUD' },
  { name: 'MRZ-4', publicKey: 'Bo2YeykUnWBsvvhXuM1D59jLxMEigKmK4DFiyyMTbsnp', faction: 'MUD' },
  { name: 'MRZ-5', publicKey: '9tzsPX6uSUxd1coA2yMYDrmVfQQGJZdZG1qDeghxeSqu', faction: 'MUD' },
  { name: 'MRZ-6', publicKey: '6aeaH8q7unhosrg3rn3eqi3pUz1DxDyU2aQvGPF2s6dg', faction: 'MUD' },
  { name: 'MRZ-7', publicKey: '3nr31TrYC7xt6qecNkWL5WwQTV2w1gDWmb84V8E5cGa1', faction: 'MUD' },
  { name: 'MRZ-8', publicKey: '9jXHpNaF5uXypLdFkUjFqTpDXkhjYizkxkfXFnFzQZjF', faction: 'MUD' },
  { name: 'MRZ-9', publicKey: 'HwSUG1sUzvk3HTyYDQk4Fx9Lk7NBGjSYKVMgUxZozp6B', faction: 'MUD' },
  { name: 'MRZ-10', publicKey: 'mAfGxchko6ZU8bRpVHQHXjfYEGBsPwmzGWxUuo4csCa', faction: 'MUD' },
  { name: 'MRZ-11', publicKey: '6nuTqwN5pPaF7KrPg6A82HigwwzuXPA4hRomfvmQyY8t', faction: 'MUD' },
  { name: 'MRZ-12', publicKey: '4a1ZvTYdSxo688PNqVwWHzmnoLkm2Hw246DGwxRw8PTE', faction: 'MUD' },
  { name: 'MRZ-13', publicKey: 'HnZX2YXwK8KZJVjAECprALtvZWhKNg9HDSzDikiQwN1M', faction: 'ONI' },
  { name: 'MRZ-14', publicKey: '5yWdAS3mLbtVC9XZyRkntEn2n5ESkTQHdxccR7rYU9hT', faction: 'ONI' },
  { name: 'MRZ-15', publicKey: '2LRnxdw5vBiF9rQbyyNYoPhChLHmg2rKNtRXxxfzfa56', faction: 'USTUR' },
  { name: 'MRZ-16', publicKey: '7T6Z2xijackDVWhazBj3iA4q1gu3smxgtyh4ujk4DzAY', faction: 'USTUR' },
  { name: 'MRZ-17', publicKey: '4Ryjdp4fXZRNKhZfytSpmKCnNMc6ZAtP7kcjQzS2tzJo', faction: 'USTUR' },
  { name: 'MRZ-18', publicKey: 'FXyMb9j1vgdM7C3dABRJsogw8zR1CP8aje7HQ4BVLQvz', faction: 'ONI' },
  { name: 'MRZ-19', publicKey: 'HaTpXV4UbfzVNdRVvAfyka76h7CK5CeB9JZuRWataFCg', faction: 'ONI' },
  { name: 'MRZ-20', publicKey: 'HctDXX6qb77pcm8CAaWQLd2dTFPAF9wqJ6NNgmdAerFX', faction: 'ONI' },
  { name: 'MRZ-21', publicKey: '6W2P5xbxUa6pKsNvErAXjc1sn6HHpUguYikoAAFxdiW1', faction: 'USTUR' },
  { name: 'MRZ-22', publicKey: '2ugE9KwRKjSyMMT5jRgDvcmoHUZPuWG5KsphFeD9zrUR', faction: 'USTUR' },
  { name: 'MRZ-23', publicKey: 'Hb8iAmumeNRccHXGLCGMEz2PMXu1yTxsfB5LSD7yhAqi', faction: 'USTUR' },
  { name: 'MRZ-24', publicKey: '9cgP7ac5PVvm7boZbGrVVraLo5DxWp2YuS11gAhDAcLH', faction: 'ONI' },
  { name: 'MRZ-25', publicKey: '8VMr5W3EPyyUqprC9W7Lwjr2mMEWxFGGx7TtoSJuQueq', faction: 'ONI' },
  { name: 'MRZ-26', publicKey: 'Ce7NahqL9T6DSKcM3VmMzSvGSpYCxzk4PxuEJsHfFvFN', faction: 'ONI' },
  { name: 'MRZ-27', publicKey: '9w2Ytk1KSm3NL6qZNCNMkGLDyyZrpHSyhHDPBNBAUwJU', faction: 'USTUR' },
  { name: 'MRZ-28', publicKey: 'DxVDHLQ43zUEXkh9BRqWgeh7agY854bztNWCarMbmFW6', faction: 'USTUR' },
  { name: 'MRZ-29', publicKey: '8EbNGvTnncC4Qo3wkXNAdZxvx211WfbgpDsGbFNwjBJP', faction: 'ONI' },
  { name: 'MRZ-30', publicKey: 'FJyuyETGV1AqwZriN68NNiVcCnEDQ4mdXL2QxkWGWihc', faction: 'ONI' },
  { name: 'MRZ-31', publicKey: '9DwqdnpuRU2AnTDYKT8oqb8Y3AS8i1sC6ywjkJV5C7mV', faction: 'ONI' },
  { name: 'MRZ-32', publicKey: 'FCX2CgE9ptWZM2WuZHhhmJxnFjkPNm1tLToTxx1Ljzaj', faction: 'USTUR' },
  { name: 'MRZ-33', publicKey: 'CmPSrYZznzuzMU17Xo6r79vWmpASVZLQgLM8zGmfBqDa', faction: 'USTUR' },
  { name: 'MRZ-34', publicKey: '6xSmiUAY646H46BAoXPQESqho5YPbjvX4RMFM7PKwdaz', faction: 'USTUR' },
  { name: 'MRZ-35', publicKey: 'Cy3mxgxshchCUgM7JuQFU2Q18wAAV6QZQZ6mxypxiizL', faction: 'USTUR' },
  { name: 'MRZ-36', publicKey: '3BAQgLWLZkqczEVA1LKvaAc48mgC18JCVepWJG8wYgTJ', faction: 'ONI' },
];

export function normalizeStarbaseRegistryName(starbase: string): string {
  return String(starbase ?? '').trim().replace(/_/g, '-').toUpperCase();
}

export function findStarbaseRegistryEntry(starbase: string): StarbaseRegistryEntry | null {
  const normalized = normalizeStarbaseRegistryName(starbase);
  return STARBASE_REGISTRY.find((entry) => entry.name === normalized) ?? null;
}
