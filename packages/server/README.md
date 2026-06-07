# @conduit-llm/server

OpenAI-compatible HTTP server for Conduit providers. The first supported API
surface is Chat Completions.

## Install

```sh
npm install @conduit-llm/server
```

## Commands

```sh
conduit-server login --device-auth
conduit-server status
conduit-server serve
conduit-server logout
```

## Environment

- `CONDUIT_SERVER_API_KEY`: bearer token required for `/v1/*` routes.
- `CONDUIT_AUTH_PATH`: token file path.
- `CONDUIT_HOST`: listen host, default `0.0.0.0`.
- `CONDUIT_PORT`: listen port, default `3000`.
- `CONDUIT_MODEL`: default provider model.
- `CONDUIT_ALLOWED_ORIGINS`: comma-separated CORS origins.

## HTTP API

```sh
curl http://localhost:3000/v1/chat/completions \
  -H "authorization: Bearer $CONDUIT_SERVER_API_KEY" \
  -H "content-type: application/json" \
  -d '{
    "model": "conduit-default",
    "messages": [{ "role": "user", "content": "Say hello" }]
  }'
```

Streaming is supported with `"stream": true` and returns Server-Sent Events in
the Chat Completions chunk format.

## Docker

Build from the repository root:

```sh
docker build -f packages/server/Dockerfile -t conduit-server:local .
```

Create or refresh the ChatGPT OAuth session:

```sh
docker run --rm -it \
  -e CONDUIT_DOCKER=1 \
  -v conduit-data:/data \
  conduit-server:local login --device-auth
```

Run the server:

```sh
docker run --rm \
  -p 3000:3000 \
  -e CONDUIT_DOCKER=1 \
  -e CONDUIT_SERVER_API_KEY="$CONDUIT_SERVER_API_KEY" \
  -v conduit-data:/data \
  conduit-server:local serve
```

The Docker token path defaults to `/data/auth.json` when `CONDUIT_DOCKER=1`.
