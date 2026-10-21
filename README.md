# ribbonboundlab

The website for **ribbonboundlab.com**, self-hosted on a homelab Kubernetes cluster.

```
git push ──► GitHub Actions ──► ghcr.io image ──► commit new tag to k8s/
                                                        │
             Argo CD (in your cluster) ◄────────────────┘
                     │
                     ▼
   nginx pods ◄── cloudflared ◄── Cloudflare ◄── visitors
   (no open ports on your router, home IP stays hidden)
```

## Layout

| Path | What it is |
|---|---|
| `site/` | The website itself (plain HTML; swap in Hugo/Astro later if you like) |
| `Dockerfile` | Packs `site/` into a non-root nginx image |
| `k8s/` | Kubernetes manifests: namespace, web Deployment + Service, Cloudflare Tunnel |
| `.github/workflows/build.yml` | Builds and pushes the image, then pins its tag in `k8s/` |
| `argocd/app.yaml` | Points Argo CD at `k8s/` so pushes deploy themselves |

## One-time setup

### 0. GitHub username
`ellie-reboots` is set in `k8s/web.yaml`, `k8s/kustomization.yaml` and
`argocd/app.yaml`. If the account ever changes, update it there (lowercase).

### 1. GitHub repo
Create a repo named `ribbonboundlab` and push these files to `main`.
The first push runs the workflow and builds the image.

Then on GitHub: your profile → **Packages** → `ribbonboundlab` →
**Package settings** → change visibility to **Public**, so the cluster can pull
it without a password. (The image only contains your public website.)

> Keep the repo itself public or add it to Argo CD with a deploy key.
> Either way, never commit secrets: the tunnel token lives only in the cluster.

### 2. Kubernetes (k3s)
On a Linux box or VM in your homelab:

```bash
curl -sfL https://get.k3s.io | sh -
sudo k3s kubectl get nodes
```

Copy `/etc/rancher/k3s/k3s.yaml` to `~/.kube/config` on your PC if you want to
run `kubectl` from there (change `127.0.0.1` to the server's LAN IP).

### 3. Argo CD

```bash
kubectl create namespace argocd
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
```

### 4. Cloudflare Tunnel
1. Cloudflare dashboard → **Zero Trust** → **Networks** → **Tunnels** →
   **Create a tunnel** → **Cloudflared**, name it `homelab`.
2. Copy the **token** from the install command it shows (the long string after `--token`).
3. Add a **Public hostname**:
   - Hostname: `ribbonboundlab.com` (add a second one for `www`)
   - Service: `HTTP` → `web.ribbonboundlab.svc.cluster.local:80`
4. Put the token in the cluster:

```bash
kubectl create namespace ribbonboundlab
kubectl -n ribbonboundlab create secret generic cloudflared-token --from-literal=token=PASTE_TOKEN_HERE
```

### 5. Turn it on

```bash
kubectl apply -f argocd/app.yaml
```

Argo CD syncs `k8s/`, the pods start, and https://ribbonboundlab.com is live.

## Day to day
Edit anything in `site/`, commit, push. About two minutes later it is live.

Check on things:

```bash
kubectl -n ribbonboundlab get pods
kubectl -n ribbonboundlab logs deploy/cloudflared
```

## Adding more homelab services later
Deploy the service in the cluster, then add another public hostname on the same
tunnel (for example `git.ribbonboundlab.com` → `http://gitea.gitea.svc.cluster.local:3000`).
For anything private (NAS, dashboards), put **Cloudflare Access** in front of it
so only you can log in.
