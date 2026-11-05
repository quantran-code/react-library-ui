# react-library-ui

The library UI. It talks to the gateway and never to a service directly.

```sh
npm install
npm run dev
```

`VITE_API_BASE_URL` points the UI at the gateway (default `http://localhost:8080`
through the dev proxy). The page currently reports the gateway's health.
