import { TestnetWallet } from "../../../components/zcash-wallet/testnet-wallet";
import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Testnet Wallet · ZYRO",
  robots: { index: false, follow: false },
};
export default function TestnetWalletPage() {
  return <TestnetWallet />;
}
