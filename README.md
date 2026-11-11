# Condor-based Crypto Trading Platform

**Condor upstream is the application.** This repository pins the official Hummingbot Condor project as a Git submodule and keeps only the integration/configuration work around it. The complete upstream Condor dashboard, backend, agents, routines, portfolio views and bot management are reused; they are not reimplemented here.

## Source of truth

- Condor: https://github.com/hummingbot/condor
- Pinned source: `upstream/condor` at commit `a817f6633a90afe41523377bfd360c0b9316d423`
- Hummingbot API: https://github.com/hummingbot/hummingbot-api
- Hummingbot engine: https://github.com/hummingbot/hummingbot
- TradingAgents (optional research only): https://github.com/TauricResearch/TradingAgents

Do not replace Condor's dashboard or backend with a parallel implementation. Keep upstream code and its MIT license/attributions intact. Any local changes must be minimal, documented, tested and kept outside upstream files unless an upstream patch is genuinely required.

## Get the complete Condor application

Clone with submodules:

```bash
git clone --recurse-submodules https://github.com/Parontv/miracolo-trading-ai.git
cd miracolo-trading-ai
git submodule status
cd upstream/condor
```

If the submodule was not downloaded:

```bash
git submodule update --init --recursive
```

Use Condor's own setup and runtime commands, not a second dashboard:

```bash
make setup
make install
make doctor
make run
```

The official Condor README and Makefile in `upstream/condor` are authoritative for supported installation, configuration, dashboard access, troubleshooting and upgrades. Condor supports local mode and Telegram mode; select the supported mode that fits the deployment. Local mode is loopback-only and has no login. Do not expose it to a network without an authenticated private access layer.

## Integration scope

- **Condor:** complete application, dashboard, orchestration, agents, routines and operational interface.
- **Hummingbot API:** official API for bot, executor, account, order and position operations.
- **Hummingbot:** official exchange connectors, strategies and execution engine.
- **TradingAgents:** optional analysis/research only; no direct exchange credentials or order execution authority.

Initial operation remains **PAPER only**. Do not enable LIVE credentials or live order routes during development. Do not expose Hummingbot API, MQTT or database services to the public Internet. Follow upstream security guidance and use private authenticated networking.

## Compatibility and validation

Condor requires Python `>=3.12,<3.14`; its frontend build uses Node.js 22. The validation workflow checks the pinned upstream source, Python tests, Condor backend imports and the Condor frontend build.

Before any deployment, verify the workflow is green and complete an end-to-end PAPER test covering connection, market data, portfolio, order placement, cancellation, bot stop/restart and recovery. A passing build alone does not prove exchange connectivity or 24/7 runtime.

## Repository policy

- No duplicate dashboard, API client or trading engine where Condor/Hummingbot already provide the capability.
- No invented risk thresholds presented as upstream defaults.
- Keep custom code only for a verified integration gap.
- Never commit API keys, passwords or exchange secrets.
- Do not claim 24/7 operation until a persistent runtime is actually deployed and monitored.
