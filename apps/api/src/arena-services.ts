import { Accounts } from "./accounts.js";
import { ArenaGames } from "./arena-games.js";
import { CryptoMarkets } from "./crypto-markets.js";
import { FastCrypto } from "./fast-crypto.js";
const services = new WeakMap<
  Accounts,
  Promise<{ games: ArenaGames; crypto: CryptoMarkets; fast: FastCrypto }>
>();
export function arenaServices(accounts: Accounts) {
  let service = services.get(accounts);
  if (!service) {
    service = (async () => {
      const games = new ArenaGames(accounts),
        crypto = new CryptoMarkets(accounts);
      await games.init();
      await crypto.init();
      const fast = new FastCrypto(accounts, crypto.provider);
      await fast.init();
      return { games, crypto, fast };
    })();
    services.set(accounts, service);
    service.catch(() => services.delete(accounts));
  }
  return service;
}
