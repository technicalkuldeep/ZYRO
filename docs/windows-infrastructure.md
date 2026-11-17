# Windows 11 infrastructure preparation

Inspection on November 17, 2026: Windows Node 22.19.0, npm 10.9.3 and Git 2.51.0; WSL2 Ubuntu-24.04 already running. WSL Rust 1.99.0 and Cargo 1.99.0 plus Clang are available. Docker Engine, Docker Compose and PostgreSQL are absent from PATH in Windows and Ubuntu.

No Windows PostgreSQL installation is proposed. Use Docker Engine inside the existing WSL distribution, then run PostgreSQL and the official Z3 regtest stack in containers. This avoids adding a Windows database service.

## Approval-required system changes

The following are the proposed Ubuntu system changes, to be executed only after explicit approval:

```sh
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-v2
sudo service docker start
```

Run Docker through `sudo docker` initially; do not change group membership or enable a boot service without a separate need. Docker control is privileged. If sudo requests an interactive password, the user must run these commands in their own WSL terminal; never send a sudo password through the application.

After installation, reversible project operations are:

```sh
cd /mnt/d/ZYRO
sudo docker compose up -d postgres
```

PostgreSQL binds to loopback only. Configure local database credentials through ignored environment files. Z3 must be pinned to an inspected commit and run with its regtest-specific environment. Never run upstream mainnet defaults. No volume deletion or system-wide Docker pruning is authorized.

Rust builds run using the existing WSL toolchain; no Rust installer or Windows system changes are needed. External upstream checkouts and build artifacts live under ignored `.local/` in the project workspace.
