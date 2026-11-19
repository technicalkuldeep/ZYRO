import OriginalTestnetPage from "../wallet/page";
import { TestnetWalletEntry } from "../../components/zcash-wallet/testnet-entry";
// Preserve the complete original observer and tooling experience byte-for-byte.
export default function TestnetPage() {
  return (
    <>
      <TestnetWalletEntry />
      <OriginalTestnetPage />
    </>
  );
}
