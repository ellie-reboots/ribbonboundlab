# Unprivileged nginx: runs as non-root and listens on 8080
FROM nginxinc/nginx-unprivileged:1.27-alpine
ARG VERSION=dev
COPY site/ /usr/share/nginx/html/
# Our server settings: pages are always rechecked so updates show up right away
COPY nginx/site.conf /etc/nginx/conf.d/default.conf
# Stamp the stylesheet link with the build version so Cloudflare's cache
# always fetches the new style.css after a deploy.
USER root
RUN sed -i "s|href=\"style.css\"|href=\"style.css?v=${VERSION}\"|g" /usr/share/nginx/html/*.html
USER 101
EXPOSE 8080
