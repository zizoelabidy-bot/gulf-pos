# GULF CCTV License Admin

Internal offline issuer. Not included in the customer installer. Production licenses use the existing GULF signing key held by the owner. Never generate a replacement production key casually or put private keys in GitHub.

## Production setup

Restore the existing matching issuer private and public PEM files into a restricted directory outside the repository. Set GULF_LICENSE_KEYS_DIR to that directory. Restrict Windows filesystem ACLs to authorized administrators; retain an encrypted backup. The CLI refuses to issue production keys if the keypair does not match the embedded client verifier. `init` generates a NEW keypair for a deliberately separate development directory; it cannot overwrite an existing private key. `--development-key` is for tests only.

## Issue

Obtain the device fingerprint from Settings > License on the actual installation.

```sh
node license-admin.cjs issue --customer "Cafe Example" --type annual --days 365 --max-devices 1 --max-branches 1 --device ACTUAL_32_HEX_FINGERPRINT
node license-admin.cjs list
node license-admin.cjs inspect --key "GPL1...."
```

Use type perpetual for a perpetual license, or trial for a signed trial. Repeat --device for authorized fingerprints, and repeat --modules for module labels. Issuance now requires explicit device bindings; legacy signed unbound keys remain accepted for compatibility. Registry listing omits full license tokens. Registry contains customer and key data: protect it and do not distribute it.

## Transfer and limitations

The local receipt is a CLAIM, not independently verifiable revocation proof. `verify-receipt` checks registry correspondence and returns exit code 2 for an unverified claim. Confirm the customer and device manually before issuing a replacement. Local deactivation blocks reuse on the same database, but restoration of older backups and copied installations can evade offline enforcement. No central revocation or concurrent seat tracking exists. Branch limits and module labels are not proven enforced across all routes. A database/device binding change may require a replacement key; preserve read/export access.

Run `node tests/gulf-license-admin.test.cjs` from the repo root with Node. Run the client licensing suite with `node tests/run-electron-node-test.cjs tests/licensing.test.ts`. Neither suite requires production signing keys.

## Administration Center desktop interface

On the authorized Windows administration workstation, install repository dependencies with npm ci. Set GULF_LICENSE_KEYS_DIR to the restricted directory containing the existing production issuer PEM files and registry, then run admin-app/START-ADMIN.cmd (or npx electron admin-app/main.cjs from the repository root). No cloud service, browser login or public web port is required. The interface is bilingual and provides issuance metrics, search and production-only issuance with confirmation. Keys are not returned in registry listing; the newly issued customer token is shown once in the result panel. Existing CLI commands remain available.

This is a source-run desktop tool, not a signed standalone administrator installer. The Windows account and filesystem ACLs are the security boundary; do not run on shared cashiers or publish the issuer directory. Without a configured matching production key, issuance is disabled. Live subscription collection, centralized revocation, support tickets and release distribution are not implemented in this interface. Test the production workstation with the existing keypair before operational use; never use a development key for a customer.


## Standalone Windows review package

From the repository root on Windows, install dependencies with npm ci and run node scripts/build-gulf-admin.cjs. The packaging script stages only explicitly allowed source and license-notice files, uses the existing GULF icon and a separate app ID, and verifies the ASAR manifest. It never copies the issuer directory or records. The output is release-admin/GULF-POS-Admin-Setup.exe. The dedicated Windows CI job builds it independently of the customer installer; no automatic publication. Unsigned review build only.

The installed app requires the existing GULF_LICENSE_KEYS_DIR environment variable pointing at a restricted issuer directory; restart the process after configuring it. No signing key is provisioned by the installer. Do not install on a shared cashier workstation. 

The Commercial Administration screen records customers, subscription periods and KWD fees, manually received payments with references, balances, and local support tickets. It does not charge a payment method or send tickets to a server. Commercial records are separate from the license registry; they are stored with Electron safeStorage (Windows DPAPI) under the administrator app userData directory. Record updates use an encrypted replacement file; the key is bound to the OS account. Cross-device restore and encrypted backup/recovery require a separate tested migration procedure. Commercial test encryption is a mock provider, not a DPAPI integration test. A full accounting audit trail, reversals, invoices/tax, customer edits, remote device management, update publishing UI, RBAC and central subscription enforcement are not implemented. Do not consider these review builds approved for operational use.
