# ribbonboundlab

The website for **ribbonboundlab.com**, self-hosted on a homelab Kubernetes cluster.
The cluster itself (Flux, Traefik, the Cloudflare Tunnel) lives in **kintsugi-lab**;
this repo only holds the site and its app manifests.

```
git push ──► GitHub Actions ──► ghcr.io image ──► commit new tag to k8s/
                                                        │
              Flux (in your cluster) ◄──────────────────┘
                     │
                     ▼
   nginx pods ◄── Traefik ◄── cloudflared ◄── Cloudflare ◄── visitors
                 (shared, in kintsugi-lab: no open ports, home IP stays hidden)
```

## Layout

| Path | What it is |
|---|---|
| `site/` | The website itself (plain HTML; swap in Hugo/Astro later if you like) |
| `Dockerfile` | Packs `site/` into a non-root nginx image |
| `k8s/` | App manifests: namespace, web Deployment + Service, Traefik Ingress |
| `.github/workflows/build.yml` | Builds and pushes the image, then pins its tag in `k8s/` |
| `flux/ribbonboundlab.yaml` | Points Flux at `k8s/`. **Move into kintsugi-lab** (`clusters/homelab/apps/`), then delete it here |

## One-time setup

### 0. GitHub username
`ellie-reboots` is set in `k8s/web.yaml`, `k8s/kustomization.yaml` and
`flux/ribbonboundlab.yaml`. If the account ever changes, update it there (lowercase).

### 1. Image visibility
After the first workflow run: your profile → **Packages** → `ribbonboundlab` →
**Package settings** → change visibility to **Public**, so the cluster can pull
it without a password. (The image only contains your public website.)

> Keep this repo public, or give Flux a deploy key (`flux create secret git`)
> and add `secretRef` to the GitRepository. Never commit secrets here.

### 2. kintsugi-lab provides
- **Flux**, bootstrapped on the cluster
- **Traefik** (k3s ships it in `kube-system`)
- **One shared Cloudflare Tunnel** whose public hostnames
  `ribbonboundlab.com` and `www.ribbonboundlab.com` point at
  `HTTP` → `traefik.kube-system.svc.cluster.local:80`

### 3. Turn it on
Copy `flux/ribbonboundlab.yaml` into kintsugi-lab under the path Flux watches
(e.g. `clusters/homelab/apps/`), commit and push. Or to try it right away:

```bash
kubectl apply -f flux/ribbonboundlab.yaml
flux get kustomizations
```

Flux syncs `k8s/`, the pods start, Traefik routes the hostnames to them,
and https://ribbonboundlab.com is live.

## Day to day
Edit anything in `site/`, commit, push. About two minutes later it is live.

Check on things:

```bash
kubectl -n ribbonboundlab get pods,ingress
flux get kustomizations ribbonboundlab
flux reconcile kustomization ribbonboundlab --with-source   # deploy now instead of waiting
```

Preview what Flux will apply:

```bash
kubectl kustomize k8s/
```
