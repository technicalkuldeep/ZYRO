import { Access } from "../../components/access";
export default function Layout({ children }: { children: React.ReactNode }) {
  return <Access admin>{children}</Access>;
}
