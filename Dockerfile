FROM node:22.23.4-alpine3.24@sha256:0e1754758c2df4cfa3e68d59e2e1b7374bb7fd9ea6328eaaacf15cc934af8202

ENV NODE_ENV=production THELOUNGE_HOME=/var/opt/thelounge
WORKDIR /opt/dnbradio-chat
COPY runtime/package.json runtime/package-lock.json ./
COPY runtime/patch-file-type.cjs ./
RUN apk add --no-cache zlib=1.4-r0 \
    && apk add --no-cache --virtual .install-deps git \
    && npm ci --omit=dev --ignore-scripts \
    && node patch-file-type.cjs \
    && npm cache clean --force \
    && apk del .install-deps \
    && test -d /usr/local/lib/node_modules/npm \
    && rm -rf /usr/local/lib/node_modules/npm \
    && rm /usr/local/bin/npm /usr/local/bin/npx \
    && mkdir -p /var/opt/thelounge \
    && chown node:node /var/opt/thelounge

COPY custom/public/img/ ./node_modules/thelounge/public/img/
COPY custom/public/favicon.ico ./node_modules/thelounge/public/favicon.ico
RUN node -e 'const fs=require("fs"); const p="node_modules/thelounge/public/index.html"; const s=fs.readFileSync(p,"utf8"); if(!s.includes("<title>The Lounge</title>")) throw Error("Review changed branding template"); fs.writeFileSync(p,s.replaceAll("The Lounge","dnbradio on Internet Relay Chat (IRC) - dnbradio"));'

USER node:node
EXPOSE 9000 9001
VOLUME /var/opt/thelounge
ENTRYPOINT ["/opt/dnbradio-chat/node_modules/.bin/thelounge"]
CMD ["start"]
