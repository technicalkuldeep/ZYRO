import { Accounts } from "./accounts.js";
import { ArenaGames } from "./arena-games.js";
import { CryptoMarkets } from "./crypto-markets.js";
const services = new WeakMap<
  Accounts,
  Promise<{ games: ArenaGames; crypto: CryptoMarkets }>
>();
export function arenaServices(accounts: Accounts) {
  let service = services.get(accounts);
  if (!service) {
    service = (async () => {
      const games = new ArenaGames(accounts),
        crypto = new CryptoMarkets(accounts);
      await games.init();
      await crypto.init();
      return { games, crypto };
    })();
    services.set(accounts, service);
    service.catch(() => services.delete(accounts));
  }
  return service;
}
