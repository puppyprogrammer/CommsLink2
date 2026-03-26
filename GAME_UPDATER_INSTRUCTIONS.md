# Game Auto-Updater — CommsLink Instructions

## What's Needed

A version check endpoint and a way to serve the game build zip.

## 1. New API Endpoint

### GET /api/v1/game/version (no auth required)

Returns:
```json
{
  "version": "0.0.2",
  "downloadUrl": "https://commslink.net/game/build.zip",
  "changelog": "Fixed multiplayer sync, added chat"
}
```

This can be a simple hardcoded route or read from a DB/config file. Hardcoded is fine for now — we update it manually each deploy.

Create `services/api/src/routes/v1/gameVersion.ts`:

```typescript
const gameVersionRoutes: ServerRoute[] = [
  {
    method: 'GET',
    path: '/api/v1/game/version',
    options: { auth: false },
    handler: async () => ({
      version: process.env.GAME_VERSION || '0.0.1',
      downloadUrl: process.env.GAME_DOWNLOAD_URL || 'https://commslink.net/game/build.zip',
      changelog: process.env.GAME_CHANGELOG || 'Latest build',
    }),
  },
];
```

Add `GAME_VERSION`, `GAME_DOWNLOAD_URL`, `GAME_CHANGELOG` to `.env.production`.

Register in routes/v1/index.ts.

## 2. Serve the build zip via nginx

On the EC2, create a directory for game builds:
```bash
sudo mkdir -p /var/www/commslink/game
sudo chown ec2-user:ec2-user /var/www/commslink/game
```

Add to nginx config (in the server block for commslink.net):
```nginx
location /game/ {
    alias /var/www/commslink/game/;
    autoindex off;
}
```

Then upload builds:
```bash
scp -i PEM build.zip ec2-user@3.134.145.169:/var/www/commslink/game/build.zip
```

## 3. Deploy flow

When we make a new build:
1. Update `GAME_VERSION` in `.env.production`
2. Build in Unity → zip the Build folder
3. Upload: `scp build.zip ec2-user@IP:/var/www/commslink/game/build.zip`
4. Done — all running clients will see the update on next launch
