# GULF CCTV License Admin

Separate admin tool for issuing and managing GULF POS commercial licenses.
Runs only on GULF CCTV's machine. It is not part of the client installer.

## Setup (once)

```
node license-admin.cjs init
```

This creates `keys/license-private.pem` and `keys/license-public.pem`.

- The **private key never leaves this machine**. It is git-ignored and must
  never be sent to anyone or included in the client app.
- Copy the public key into the client before building the installer:
  ```
  node license-admin.cjs pubkey
  ```
  Paste the printed PEM over the `EMBEDDED_PUBLIC_KEY_PEM` constant in
  `main/services/licensing.ts`.

## Issuing licenses

Annual, 2 devices, 1 branch, all modules:

```
node license-admin.cjs issue --customer "Cafe Example" --type annual --days 365 \
  --max-devices 2 --max-branches 1 --modules '*'
```

Perpetual:

```
node license-admin.cjs issue --customer "Cafe Example" --type perpetual --max-devices 1
```

Extendable trial key (the app also has a built-in 14-day trial without a key):

```
node license-admin.cjs trial --customer "Cafe Example" --days 30
```

Restrict modules (comma not supported; repeat the flag):

```
--modules pos --modules reports --modules inventory
```

Bind a key to specific device fingerprints (shown in the app's Settings ->
License page):

```
--device 1a2b3c... --device 4d5e6f...
```

Every issued key is appended to `keys/issued-licenses.jsonl` (your registry).

## Inspecting a key

```
node license-admin.cjs inspect --key "GPL1...."
```

## License transfer (offline)

1. On the old device: Settings -> License -> Deactivate. The app shows a
   transfer receipt.
2. The customer sends you that receipt.
3. Verify it here: `node license-admin.cjs verify-receipt --receipt "GPLR1...."`
4. Issue a new key bound to the new device's fingerprint.

## Expiry behaviour

GULF POS never deletes or locks away customer data. After expiry (plus a
7-day grace period for paid licenses) the app blocks new sales but keeps
reports, viewing and export available.
