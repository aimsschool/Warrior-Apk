# Warrior OTP API v3.3.0

Vercel serverless relay for the Warrior Android companion and Chrome/Edge extension. It implements protocol v3 and stores short-lived pairing and OTP state in Redis.

## Deploy

1. Import this repository into Vercel.
2. Name the project `warrior-otp-api` if that project name is available.
3. In Vercel, open **Storage / Marketplace** and create or connect a Redis provider (for example Upstash Redis).
4. Connect the Redis integration to this project so its environment variables are available in Production and Preview.
5. Deploy.
6. Verify `https://YOUR-PROJECT.vercel.app/health` returns:

```json
{"ok":true,"service":"warrior-otp-pairing","protocolVersion":3}
```

Vercel's Redis Marketplace integration normally supplies `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`; the Upstash SDK also accepts the equivalent `KV_REST_API_URL` and `KV_REST_API_TOKEN` names. Do not commit these values.

## Protocol routes

- `GET /health`
- `POST /v1/browser/invite`
- `POST /v1/browser/approve`
- `POST /v1/browser/status`
- `POST /v1/browser/request`
- `POST /v1/phone/claim`
- `POST /v1/phone/status`
- `POST /v1/phone/submit`
- `POST /v1/phone/disconnect`

Pairing codes expire after 10 minutes. OTP requests expire after 60 seconds. OTPs are short-lived and are never written to logs by the application.

## Security

Use HTTPS only. The relay is intended for the owner's authorized devices and accounts. The APK and extension must use the exact same Vercel origin. This API is not a general OTP bypass service and should not be used to defeat another provider's verification controls.
