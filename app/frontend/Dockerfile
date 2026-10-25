FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY html/ /usr/share/nginx/html/
# nginx-unprivileged tourne déjà avec l'utilisateur nginx (uid 101) et écoute sur 8080
EXPOSE 8080
