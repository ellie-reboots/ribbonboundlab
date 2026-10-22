# Website on Kubernetes (no Docker)

One domain, routed by path:

| Path | App | Files |
|---|---|---|
| `/` | Homepage | `site/index.html`, `homepage-nginx.conf`, `k8s/homepage.yaml` |
| `/voice/` | Voice Pitch Trainer | `../voice-trainer.html`, `trainer-nginx.conf`, `k8s/trainer.yaml` |

The Ingress is the front door and sends each path to its own app. Each app is a small Deployment running the stock `nginxinc/nginx-unprivileged` image, with its pages and nginx config mounted from ConfigMaps that kustomize builds from these files. There's no image to build.

Pitch detection, voice care, sessions and PDF reports all run in each visitor's browser. The server only sends out pages and never receives voice data.

## What you need

- `kubectl` with access to your cluster
- In the cluster: **metrics-server** (for autoscaling), **ingress-nginx** and **cert-manager**
- A domain name. Browsers only allow the microphone on `https://` pages, so over plain `http://` the trainer loads but **Start microphone** fails.
- [k6](https://k6.io) for the load test

## 1. Set your domain

In `k8s/ingress.yaml`, change both `example.com` entries to your domain, and the `cluster-issuer` name if yours isn't `letsencrypt`.

## 2. Deploy

Run from the folder that contains `voice-trainer.html`:

```bash
kubectl kustomize --load-restrictor LoadRestrictionsNone deploy/k8s | kubectl apply -f -
kubectl -n website rollout status deploy/homepage deploy/trainer
kubectl -n website get ingress,certificate
```

The `--load-restrictor` flag lets kustomize read `voice-trainer.html`, which sits outside the `deploy` folder.

Before the domain and certificate are ready, check each app through a port-forward (the mic works here because it's localhost):

```bash
kubectl -n website port-forward svc/homepage 8080:80
kubectl -n website port-forward svc/trainer 8081:80
```

Then open http://localhost:8080/ and http://localhost:8081/voice/.

## 3. Scale test

Watch the autoscalers and pods:

```bash
kubectl -n website get hpa,pods -w
```

Run the load test against your domain:

```bash
k6 run -e BASE_URL=https://example.com deploy/loadtest/k6.js
```

Each virtual visitor loads the homepage, then the trainer. The test ramps to 300 visits per second, holds, then stops. Pass criteria: under 1% errors and 95th percentile under 300 ms for each page. Watch both HPAs scale up from 2 pods while CPU is above 60%, then back down a couple of minutes after the test ends.

To push harder, raise the `target` values in `k6.js`. A small nginx pod usually serves thousands of these pages per second, so the ingress controller or your network link often becomes the limit first.

## Updating

Edit `site/index.html` or `voice-trainer.html` and run the deploy command again. ConfigMap names include a hash of their contents, so only the app whose files changed rolls to the new version, keeping at least one pod serving.

## Adding another app

1. Copy `k8s/homepage.yaml` to `k8s/<name>.yaml` and replace `homepage` with `<name>` throughout.
2. Add its files and a `configMapGenerator` entry for each in `k8s/kustomization.yaml`, and add the new YAML under `resources`.
3. In its nginx config, serve it under its path (see `trainer-nginx.conf` for the `/voice/` pattern), and mount its files under that folder.
4. Add a path for it in `k8s/ingress.yaml` above the `/` entry.
5. Add a card for it in `site/index.html`.

For bigger sites, note that a single ConfigMap holds up to 1 MiB. Past that, keep files on a persistent volume or pull them from a Git repo when the pod starts.

## Notes

- **Shared browser storage:** every app on one domain shares the same browser storage. The trainer's saved sessions are only safe from other apps if those apps are ones you trust. Keep anything you didn't write on a separate subdomain.
- **Microphone:** only `/voice/` responses allow the microphone. The homepage blocks it.
- **External downloads:** the pages load fonts from Google Fonts, and the trainer loads its PDF library from cdnjs. Each app's Content-Security-Policy allows only what it uses (plus Discord webhooks for the trainer).
- **The Discord bot is different:** a Discord bot holds one live connection per bot token, so you can't just add replicas. It would run as a single pod (or use Discord sharding at large scale), and its CPU grows with the number of people it's coaching at the same time.
