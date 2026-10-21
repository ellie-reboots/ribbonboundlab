# Unprivileged nginx: runs as non-root and listens on 8080
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY site/ /usr/share/nginx/html/
EXPOSE 8080
