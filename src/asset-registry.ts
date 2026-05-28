export type AssetRegistryEntry = {
  name: string;
  mint: string;
};

export type AssetRegistryGroup = 'raw' | 'components' | 'ships' | 'ship-parts';

const SHIP_PART_SUFFIX = ' (ship parts)';

export const GM_MARKET_ASSET_REGISTRY: AssetRegistryEntry[] = [
  { name: 'Arco', mint: 'ARCoQ9dndpg6wE2rRexzfwgJR3NoWWhpcww3xQcQLukg' },
  { name: 'Biomass', mint: 'MASS9GqtJz6ABisAxcUn3FeR4phMqH1XfG6LPKJePog' },
  { name: 'Carbon', mint: 'CARBWKWvxEuMcq3MqCxYfi7UoFVpL9c4rsQS99tw6i4X' },
  { name: 'Copper Ore', mint: 'CUore1tNkiubxSwDEtLc3Ybs1xfWLs8uGjyydUYZ25xc' },
  { name: 'Diamond', mint: 'DMNDKqygEN3WXKVrAD4ofkYBc4CKNRhFUbXP4VK7a944' },
  { name: 'Hydrogen', mint: 'HYDR4EPHJcDPcaLYUcNCtrXUdt1PnaN4MvE655pevBYp' },
  { name: 'Iron Ore', mint: 'FeorejFjRRAfusN9Fg3WjEZ1dRCf74o6xwT5vDt3R34J' },
  { name: 'Lumanite', mint: 'LUMACqD5LaKjs1AeuJYToybasTXoYQ7YkxJEc4jowNj' },
  { name: 'Nitrogen', mint: 'Nitro6idW5JCb2ysUPGUAvVqv3HmUR7NVH7NdybGJ4L' },
  { name: 'Rochinol', mint: 'RCH1Zhg4zcSSQK8rw2s6rDMVsgBEWa4kiv1oLFndrN5' },
  { name: 'Silica', mint: 'SiLiCA4xKGkyymB5XteUVmUeLqE4JGQTyWBpKFESLgh' },
  { name: 'Titanium Ore', mint: 'tiorehR1rLfeATZ96YoByUkvNFsBfUUSQWgSH2mizXL' },
  { name: 'Ammo', mint: 'ammoK8AkX2wnebQb35cDAZtTkvsXQbi82cGeTnUvvfK' },
  { name: 'Copper', mint: 'CPPRam7wKuBkYzN5zCffgNU17RKaeMEns4ZD83BqBVNR' },
  { name: 'Copper Wire', mint: 'cwirGHLB2heKjCeTy4Mbp4M443fU4V7vy2JouvYbZna' },
  { name: 'Crystal Lattice', mint: 'CRYSNnUd7cZvVfrEVtVNKmXiCPYdZ1S5pM5qG2FDVZHF' },
  { name: 'Electromagnet', mint: 'EMAGoQSP89CJV5focVjrpEuE4CeqJ4k1DouQW7gUu7yX' },
  { name: 'Electronics', mint: 'ELECrjC8m9GxCqcm4XCNpFvkS8fHStAvymS6MJbe3XLZ' },
  { name: 'Energy Substrate', mint: 'SUBSVX9LYiPrzHeg2bZrqFSDSKkrQkiCesr6SjtdHaX' },
  { name: 'Field Stabilizers', mint: 'FiELD9fGaCgiNMfzQKKZD78wxwnBHTwjiiJfsieb6VGb' },
  { name: 'Food', mint: 'foodQJAztMzX1DKpLaiounNe2BDMds5RNuPC6jsNrDG' },
  { name: 'Framework', mint: 'FMWKb7YJA5upZHbu5FjVRRoxdDw2FYFAu284VqUGF9C2' },
  { name: 'Fuel', mint: 'fueL3hBZjLLLJHiFH9cqZoozTG3XQZ53diwFPwbzNim' },
  { name: 'Graphene', mint: 'GRAPHKGoKtXtdPBx17h6fWopdT5tLjfAP8cDJ1SvvDn4' },
  { name: 'Hydrocarbon', mint: 'HYCBuSWCJ5ZEyANexU94y1BaBPtAX2kzBgGD2vES2t6M' },
  { name: 'Iron', mint: 'ironxrUhTEaBiR9Pgp6hy4qWx6V2FirDoXhsFP25GFP' },
  { name: 'Magnet', mint: 'MAGNMDeDJLvGAnriBvzWruZHfXNwWHhxnoNF75AQYM5' },
  { name: 'Particle Accelerator', mint: 'PTCLSWbwZ3mqZqHAporphY2ofio8acsastaHfoP87Dc' },
  { name: 'Polymer', mint: 'PoLYs2hbRt5iDibrkPT9e6xWuhSS45yZji5ChgJBvcB' },
  { name: 'Power Source', mint: 'PoWRYJnw3YDSyXgNtN3mQ3TKUMoUSsLAbvE8Ejade3u' },
  { name: 'Radiation Absorber', mint: 'RABSXX6RcqJ1L5qsGY64j91pmbQVbsYRQuw1mmxhxFe' },
  { name: 'Strange Emitter', mint: 'EMiTWSLgjDVkBbLFaMcGU6QqFWzX9JX6kqs1UtUjsmJA' },
  { name: 'Steel', mint: 'STEELXLJ8nfJy3P4aNuGxyNRbWPohqHSwxY75NsJRGG' },
  { name: 'Super Conductor', mint: 'CoNDDRCNxXAMGscCdejioDzb6XKxSzonbWb36wzSgp5T' },
  { name: 'Survey Data Unit', mint: 'SDUsgfSZaDhhZ76U3ZgvtFiXsfnHbf2VrzYxjBZ5YbM' },
  { name: 'Titanium', mint: 'TTNM1SMkM7VKtyPW6CNBZ4cg3An3zzQ8NVLS2HpMaWL' },
  { name: 'Toolkits', mint: 'tooLsNYLiVqzg8o4m3L2Uetbn62mvMWRqkog6PQeYKL' },

  { name: 'Busan Pulse', mint: 'puLSevjndZbxLSynPQgGVh7oPCGimhqLppV5Kb8o3S8' },
  { name: 'Fimbul Airbike', mint: 'Fw8PqtznYtg4swMk7Yjj89Tsj23u5CJLfW5Bk8ro4G1s' },
  { name: 'Fimbul ECOS Unibomba', mint: '9zrgra3XQkZPt8XNs4fowbqmj7B8bBx76aEmsKSnm9BW' },
  { name: 'Ogrika Ruch', mint: 'RUCHH4AcvodBcndmcT17KUBbd5ee5LQtmpsfvBVNnPH' },
  { name: 'Opal Jet', mint: 'Ev3xUhc1Leqi4qR2E5VoG9pcxCvHHmnAaSRVPg485xAT' },
  { name: 'Pearce X4', mint: '2iMhgB4pbdKvwJHVyitpvX5z1NBNypFonUgaSAt9dtDt' },
  { name: 'VZUS solos', mint: 'HjFijcGWKgfDwGpFX2rqFwEU9jtEgFuRQAJe1ERXFsA3' },
  { name: 'Calico Maxhog', mint: 'GxpbUDxYYvxiUejHcAMzeV2rzdHf6KZZvT86ACrpFgXa' },
  { name: 'Calico Scud', mint: 'F3HitKsp52UPqBMEWSeTFqrGgnfYbS9DMrJCz9dM3w6D' },
  { name: 'Fimbul Lowbie', mint: '7Xs3yt9eJPuEexZrKSGVbQMXHwWUKHGeDZnM4ZksZmyS' },
  { name: 'Ogrika Niruch', mint: '7SUoWHWWJCxCe5g9XqZkCRufGHXRV8nauuz69HPjuewr' },
  { name: 'Opal Jetjet', mint: '9ABNesWj7NVdkDgko7UjVaDp5pTh8a6wfXHLWz3bZM6W' },
  { name: 'Pearce X5', mint: '267DbhCypYzvTqv72ZG5UKHeFu56qXFsuoz3rw832eC5' },
  { name: 'Armstrong IMP Tip', mint: 'DTbNmLWfu1pm4AuXRKYTApnDNfxMz73VET7nW5wizG5t' },
  { name: 'Busan Thrill of Life', mint: 'FTk1E5UoWkiZEUttCWSYYaVokxWNNp3yJ42HbNDCAkdt' },
  { name: 'Calico Medtech', mint: '4gR3ChfdQxR4BTbgeWSdf6b8kD8Ysu6WBAQqtJ9oLgbF' },
  { name: 'Calico Shipit', mint: 'SHiPitEZcCoyXEKqw9ovCdYeNzck9uVbb1KCcsHaGhc' },
  { name: 'Fimbul BYOS Earp', mint: '6SqLuwHNRC1qjo9KATLKJLszFHMWyYaNxDXraCEUtfdR' },
  { name: 'Ogrika Mik', mint: 'FMHHwUB6amLWYhWxtiZHC2g5azy9usPTLMq46N3HEgFU' },
  { name: 'Opal Rayfam', mint: 'RaYfM1RLfxQJWF8RZravTshKj1aHaWBNXF94VWToY9n' },
  { name: 'Pearce R6', mint: 'Fys8J53cquYsg5zYfeZStVGNwM9FopFw8QFkiE9CCR1J' },
  { name: 'Pearce X6', mint: '8RveLFEyteyL1vbCKPQJxjf3JT1ACyrzs46TXbJStrHG' },
  { name: 'Rainbow Chi', mint: 'DsJHgpnNovjJ981QJJnqMggexAekNawbSavfV1QuTpis' },
  { name: 'Tufa Feist', mint: 'HsdbLvZrEgN2ZhsrZs5ag4F2FNFCHjjuXPfbVAhkeJBZ' },
  { name: 'VZUS ambwe', mint: 'H2jHqvXA2oxSpEp6dKkpK7WeszQEdFW5n25mNfrJFAc1' },
  { name: 'Armstrong IMP Tap', mint: 'ARNZXUQoBKx3JCX3UJB4aitSnvcjMMphN9YVDFy1PdKq' },
  { name: 'Calico ATS Enforcer', mint: '2XYd22LSFGxN7kWgoEeaXVZqgrsPeQLHLEgNhnS12Mny' },
  { name: 'Calico Compakt Hero', mint: 'AkNbg12E9PatjkiAWJ3tAbM479gtcoA1gi6Joa925WKi' },
  { name: 'Calico Evac', mint: '4txpjHspP4usEsQTr3AcrpyHVjN4fi3d4taM6cmKJnd1' },
  { name: 'Fimbul Mamba', mint: '6Zj61HuX1E7SCUCf9WsKXw1jdJCobAwK4RSjZvbv35tM' },
  { name: 'Fimbul Mamba EX', mint: 'MEXfyQHowwqoTHsN6yjfeXVaxZxALUFJAHuzY8gFiUu' },
  { name: 'Fimbul BYOS Packlite', mint: '7V9C2XUQgCb31n7hGKqKGu4ENcvqXhJLJzU77CAQtXhw' },
  { name: 'Fimbul BYOS Ranger', mint: 'RNGRjeGyFeyFT4k5aTJXKZukVx3GbG215fcSQJxg64G' },
  { name: 'Ogrika Tursic', mint: 'J8Q6jYsrhhaeczyPBo9xzVyy4GpfCnJwj14LJn2HnuKp' },
  { name: 'Pearce F4', mint: '9MvZS3TVfv4DZL9W2pT12po384aBHf7wi89KXQ9Z7uwW' },
  { name: 'Rainbow Om', mint: 'HzBx8PP86pyPrrboTHqPYWhxnEB5vXDHDBP8femWfPTS' },
  { name: 'VZUS opod', mint: '9czEqEZ4EkRt7N3HWDcw9qqwys3xRRjGdbn8Jhk8Khwj' },
  { name: 'Fimbul BYOS Butch', mint: 'BBUTCn3jcXKjFYuuYtY8MNo8bDg9VsZaKwaSYnRr2Qse' },
  { name: 'Fimbul ECOS Greenader', mint: 'FpwV1Da6BZJnYPr1JSLUm14UwBmZHA7J5WLY4TXgbde8' },
  { name: 'Ogrika Sunpaa', mint: '4b4mhSySBcryzBPamw8v4xeneFRA6xTUA4JA99w6vqey' },
  { name: 'Ogrika Thripid', mint: 'CWxNX9sTexuqvQefqskhP9f6AP5C8hq2VNkicRseqAT5' },
  { name: 'Opal Bitboat', mint: '8pPDsMNcz4m8jaajFMFXHGcvaeVeiQhcenvSD6a4XNyq' },
  { name: 'Pearce R8', mint: '2bCgKTo11QayWBy6QryHZMqZL2ZgWd5LEAZKiTGQi4g7' },
  { name: 'Rainbow Arc', mint: 'EbLBLN44BVLjifLNBbchXFr8QjEkAGYENKuNEaDuyVPL' },
  { name: 'Armstrong IMP', mint: 'GmVKV9W3qZcERxk7hjqwRDcn9Kgtz3XDi7KfFLdGqyaW' },
  { name: 'Busan Maiden Heart', mint: '6HzZJwrcuBBmrE7SLDfxheZGAD3NYJ531C9JsNesL9BP' },
  { name: 'Calico Guardian', mint: 'DdpXnnYsyUQgJby8TDHbmPwkKyGF4U6bXwCXTQZsrfKP' },
  { name: 'Fimbul Sledbarge', mint: 'SLEDkN916vvcpucY9Vn7tAzNXRcxsq71kkXzaj1cxoX' },
  { name: 'Fimbul ECOS Bombarella', mint: '7M6RHgPiHXiZAin5ManH63cLYGt3miQ54KaGynUQoERS' },
  { name: 'Ogrika Jod Asteris', mint: 'HJBmBYyGR8z1oajAM4jiK46uobuxeJoKDYpFwzWHBvhb' },
  { name: 'Pearce C9', mint: '5f1jUARhtSypVA4uTpgpLp76WYGdB2dGr8zMbh4WjYRf' },
  { name: 'Pearce D9', mint: 'H3cgBXWpUiNsYjUWS7cNR5Bmehh7k5CgpJccc5wSfRbJ' },
  { name: 'VZUS ballad', mint: 'FFkPvwLDYuKDW9eAAr5UNfuX3U9PcTGeSk7gqNX7EpNc' },
  { name: 'Fimbul BYOS Tankship', mint: '4ns3shP4WunCtJbr2HFu31RjjxSJxDymEFcBZxiHr11s' },
  { name: 'Fimbul ECOS Treearrow', mint: 'HqPN13pLUVJRiuGSsKjfWZvGKAagK98PshuKu51bnG4E' },
  { name: 'Pearce C11', mint: '9ifQ16N5DdUFoejCwsgR73ihUwadAe3srCo9HhQe2zL2' },
  { name: 'Busan The Last Stand mk. VIII', mint: 'Cvy691GFw2j3H8e6yf7hZtaQi5P3skQR4gzM6UWvcL7L' },
  { name: 'Fimbul ECOS Superphoenix', mint: '2BMTgfgapuqYBwSRGu6HCafwDGRVTxMkQVhYrNWQGTWH' },
  { name: 'Pearce T1', mint: '56nh4FvMJnSpkWJcmXc1nJtYhSQXuqb7nVMGALr31RVc' },
  { name: 'Rainbow Phi', mint: 'phi4PYgmxeTMLLpGkU87T16VUZ6AjWZESkfT1JGJ635' },

  { name: 'Fimbul Airbike (ship parts)', mint: 'SP935x1ksMqw2kDi7Tg6E9Rt4sKFBx9CKM227vgYNTK' },
  { name: 'Fimbul ECOS Unibomba (ship parts)', mint: 'SPjm3Q229eBCftiidm8HEfwyuEWwPi7pByzSnmouKHn' },
  { name: 'Ogrika Ruch (ship parts)', mint: 'SP8wv47jZkfqyBXH184f8TqY7A9QXUswkRCD6k9hVg2' },
  { name: 'Opal Jet (ship parts)', mint: 'SPUAxnUwDeWzzBcXhB2JdTNgyDY2Quwxz6G2GQMmsQj' },
  { name: 'Pearce X4 (ship parts)', mint: 'SPX4TsjfMSyMGJqAASY9NhKzTSd8XmTuMu1eYWwFw3u' },
  { name: 'VZUS solos (ship parts)', mint: 'SPpEEM5tPipQc7GHTyBtXw1G2s7gfWu8UVqikwJgp6j' },
  { name: 'Calico Maxhog (ship parts)', mint: 'SPGRLJuSZwLcejjiBAqfh8YJVYYDa7DYA2QU99h9M14' },
  { name: 'Fimbul Lowbie (ship parts)', mint: 'SPoTBZxWKJ8ayxufK2mNKLmcbDABqSmNMVPQot5q9uV' },
  { name: 'Ogrika Niruch (ship parts)', mint: 'SPQuyr4AsPoRRLBpHcgRhatoaNqdS4eTCx8xHyW6dp5' },
  { name: 'Opal Jetjet (ship parts)', mint: 'SPjRydMf7VDceWDR6L9B8rHrrERbRA8h1pD3GzwFvwd' },
  { name: 'Pearce X5 (ship parts)', mint: 'SPdndwbTiwYvTqqmUcruVcSXPuVEEwzkTxYietBh7Gh' },
  { name: 'Armstrong IMP Tip (ship parts)', mint: 'SP9t6DXorrHvmWnQp2fWniuLzE9gi33Q6CceKiyu9s6' },
  { name: 'Busan Thrill of Life (ship parts)', mint: 'SPDDvSwj33te4d1NfVGmTyKsixzrV3A5b6riaQRriLo' },
  { name: 'Calico Medtech (ship parts)', mint: 'SPGkQWEj9DmaGH3HkS6nobCwUCYDspYMgTQcXfXMNX9' },
  { name: 'Calico Shipit (ship parts)', mint: 'SPeLpYEcQLLenUEGUhs6yuqUo7NjZkWjkRXLgYkGyjQ' },
  { name: 'Fimbul BYOS Earp (ship parts)', mint: 'SPejJQrb8HhKob3RkVGmT5gN9uSdeY8fXMX7jFqfWvc' },
  { name: 'Ogrika Mik (ship parts)', mint: 'SP9Z5zYNRLTikxMYdcLUhTHmaarXmz1kjYoVja2JDWP' },
  { name: 'Opal Rayfam (ship parts)', mint: 'SPPzuW7FaABwfnhKoBVb2HiaRAs8BqfBdSgU1G1W5LA' },
  { name: 'Pearce R6 (ship parts)', mint: 'SPNcYhJiw1uLP1Dc5TUm4FKewaNWLeTBgLG3i6oMW3M' },
  { name: 'Pearce X6 (ship parts)', mint: 'SPKi4Zirg1ekZKxsgXeYvpbHzMGjAUtg6McvKDep9WA' },
  { name: 'Rainbow Chi (ship parts)', mint: 'SPADReGEYZNVNeuDDAtPdz2f243nhB8LzUpUYt1nc8L' },
  { name: 'Tufa Feist (ship parts)', mint: 'SPQm3JuAfgEdnt7DYpM13mKy5woivy2oHZeTTTvDgWK' },
  { name: 'VZUS ambwe (ship parts)', mint: 'SPQLP2vM2BPwWPCVKYjV26Qq1VNYjF7hgqWUnSBz9YF' },
  { name: 'Armstrong IMP Tap (ship parts)', mint: 'SP4g7dXZBAMPGhjNi46bM2oqMkHx7j5PvsFqqpymZRb' },
  { name: 'Calico ATS Enforcer (ship parts)', mint: 'SPYX1UhN7Wo5bhF7cex34KrigYppE1GjMWqBUipsVMz' },
  { name: 'Calico Compakt Hero (ship parts)', mint: 'SPZVqpuczgvFRokSaSvxNro2bQMBvbMqgrffbochuSn' },
  { name: 'Calico Evac (ship parts)', mint: 'SPLxmJj7AwFA96d2coWx1rs1q8tcoD8qBJbcy1RfjAj' },
  { name: 'Fimbul Mamba (ship parts)', mint: 'SPi7AZjSBSCu3enPGBTE8krSqUrbcjXQfqKrbdPSxH8' },
  { name: 'Fimbul Mamba EX (ship parts)', mint: 'SPfWuneqCNZMpygohFFY2czsC2dNf5KG85DwzAW2JKt' },
  { name: 'Fimbul BYOS Packlite (ship parts)', mint: 'SPjkody6rBMwLEKjPrpT7B8Q5WnbrQyCJzwf9ya3sYJ' },
  { name: 'Fimbul BYOS Ranger (ship parts)', mint: 'SPnu72dCxh45NbFXZv6PJu2o4qzCV3192dt75vni3Vj' },
  { name: 'Ogrika Tursic (ship parts)', mint: 'SPHMQcpDQxAwERjHeGcwbcg7CwTZSXNCQbS2PahPHVE' },
  { name: 'Pearce F4 (ship parts)', mint: 'SPzNT8sx2s36Xbh4Cyfpc64Fg6HddNJJbv1J8bPnYMG' },
  { name: 'Rainbow Om (ship parts)', mint: 'SPrRobRPWhJWjVEsbL5r8B3fRbvee9sLhGG678bv2uf' },
  { name: 'VZUS opod (ship parts)', mint: 'SPvvHMuffWKRz9dFAGkXaf9MeBTPEskpN1PvC53oFwz' },
  { name: 'Fimbul BYOS Butch (ship parts)', mint: 'SPZzXCbAo74ZBzmrVUgaMr8HN9pSGSbu62GcfTks3tY' },
  { name: 'Fimbul ECOS Greenader (ship parts)', mint: 'SP7YWWAZDe8drm2VU8HFVvTVJzrDzvK8C2ee2SE8JXn' },
  { name: 'Ogrika Sunpaa (ship parts)', mint: 'SPoTGuqXiCgbPFpvTn22erQMuTHFYYsbnxEfhhJqYga' },
  { name: 'Ogrika Thripid (ship parts)', mint: 'SP2eWeShQ2KrGWrxtZbDAAXCdfof43FJueUo1KqAxzq' },
  { name: 'Opal Bitboat (ship parts)', mint: 'SPXgrxorCaXHvdfhQbwkDpetUXCZAsDs3E4MZDUdcTp' },
  { name: 'Pearce R8 (ship parts)', mint: 'SP1fvRw24ToEsmjsZN7c8sMAusSA48C17hcn9qrGVAR' },
  { name: 'Rainbow Arc (ship parts)', mint: 'SP6PnRjWPHz3RxF15qy9PXXLkkirsyibb2V6S3P8u5o' },
  { name: 'Armstrong IMP (ship parts)', mint: 'SPx7SaZbdvZ2DAq5nk1QAMUAZaqmETT6vyMmBpEotsB' },
  { name: 'Busan Maiden Heart (ship parts)', mint: 'SP4CAzVMkiYHQvMNUj6JJ9GL3tK1RU3HxY3iR6oPvGE' },
  { name: 'Calico Guardian (ship parts)', mint: 'SPaBk8C9A1ubKBVSBJvdUQWMd9fQmYdSd7kTf5XH2pv' },
  { name: 'Fimbul Sledbarge (ship parts)', mint: 'SPBLA6iXiTJ8LbmYTxPpzqKcgvrYaaRjAtCtppYkop4' },
  { name: 'Fimbul ECOS Bombarella (ship parts)', mint: 'SPAuBnNyFuJZJZkveJEpizp4o56KEvPmnCx9HMAkXrR' },
  { name: 'Ogrika Jod Asteris (ship parts)', mint: 'SP1MdhiYHXosr2geEse9tK8rGBnkf7nsdMjFHXgnQnQ' },
  { name: 'Pearce C9 (ship parts)', mint: 'SPTDyxPxs3NwaArzZp5xrtLSujtpn6nTbLsgsRProrD' },
  { name: 'Pearce D9 (ship parts)', mint: 'SPjrTK2QaAxz3EMMzm1K1Q5jdGvkBR4Nu7QtiBNCB7c' },
  { name: 'VZUS ballad (ship parts)', mint: 'SPQ6rRhhy9CBb9FyhPsydF7MBvMGX2Ekg55zBwagSUc' },
  { name: 'Fimbul BYOS Tankship (ship parts)', mint: 'SPUynJ6UU4LRKWMogCqMC1SFxzqhh3mNLmqwtDxU2Sw' },
  { name: 'Fimbul ECOS Treearrow (ship parts)', mint: 'SP9odyU6RPeW6WRY9e5g7K6qHR7KvnsBtnuzab5eX9G' },
  { name: 'Pearce C11 (ship parts)', mint: 'SP16CbhAfUvbeWjQveE6j22k2okBGAbEKmxEcSUgLFi' },
  { name: 'Busan The Last Stand mk. VIII (ship parts)', mint: 'SPaAfAJk3RWu5x81VT2Spf4FGwXsLvNBeirMKXYhWVT' },
  { name: 'Fimbul ECOS Superphoenix (ship parts)', mint: 'SPrYTd7sBCmPhNNfyoMMPZxthxHiDtTo1ffbijobouf' },
  { name: 'Pearce T1 (ship parts)', mint: 'SPLwp5EsvGcH4uM2SbvMDTTXbe92LFVWrHwoUTXoxdP' },
  { name: 'Rainbow Phi (ship parts)', mint: 'SPBYj9Ef1q7c4inWJfCUDJJr2KLUgZ4PtB7g46zBYU1' }];

export async function loadAssetRegistryForAephiaKey(_apiKey: string): Promise<AssetRegistryEntry[]> {
  // Temporary local fallback until Aephia exposes a server-side GM market asset registry endpoint.
  // Keep callers using this function so the source can switch to the Aephia API without bot logic changes.
  return GM_MARKET_ASSET_REGISTRY;
}

export function formatAssetRegistryResourceList(registry: AssetRegistryEntry[] = GM_MARKET_ASSET_REGISTRY): string {
  return registry.map((entry) => `${entry.name}:${entry.mint}`).join('\n');
}

function getRegistryRangeByGroup(group: AssetRegistryGroup, registry: AssetRegistryEntry[] = GM_MARKET_ASSET_REGISTRY): AssetRegistryEntry[] {
  if (group === 'ships') {
    const startIndex = registry.findIndex((entry) => entry.name === 'Busan Pulse');
    const endIndex = registry.findIndex((entry) => entry.name === 'Rainbow Phi');
    return startIndex >= 0 && endIndex >= startIndex ? registry.slice(startIndex, endIndex + 1) : [];
  }

  if (group === 'ship-parts') {
    const startIndex = registry.findIndex((entry) => entry.name === 'Fimbul Airbike' + SHIP_PART_SUFFIX);
    const endIndex = registry.findIndex((entry) => entry.name === 'Rainbow Phi' + SHIP_PART_SUFFIX);
    return startIndex >= 0 && endIndex >= startIndex ? registry.slice(startIndex, endIndex + 1) : [];
  }

  return registry;
}

export function findAssetRegistryEntryForGroupAndName(
  group: AssetRegistryGroup,
  name: string,
  registry: AssetRegistryEntry[] = GM_MARKET_ASSET_REGISTRY,
): AssetRegistryEntry | null {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) {
    return null;
  }

  const grouped = getRegistryRangeByGroup(group, registry);
  const directMatch = grouped.find((entry) => entry.name === trimmed);
  if (directMatch) {
    return directMatch;
  }

  if (group === 'ship-parts') {
    const suffixName = trimmed.endsWith(SHIP_PART_SUFFIX) ? trimmed : trimmed + SHIP_PART_SUFFIX;
    return grouped.find((entry) => entry.name === suffixName) ?? null;
  }

  if (group === 'ships') {
    const baseName = trimmed.endsWith(SHIP_PART_SUFFIX) ? trimmed.slice(0, -SHIP_PART_SUFFIX.length) : trimmed;
    return grouped.find((entry) => entry.name === baseName) ?? null;
  }

  return grouped.find((entry) => entry.name === trimmed) ?? null;
}
