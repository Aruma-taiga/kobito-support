FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends openjdk-17-jre-headless \
  && rm -rf /var/lib/apt/lists/* \
  && npm install --global firebase-tools@14.22.0

WORKDIR /workspace
COPY firebase.json ./firebase.json
EXPOSE 9099
CMD ["firebase", "emulators:start", "--only", "auth", "--project", "demo-kobito-support", "--config", "/workspace/firebase.json"]
