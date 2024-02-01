FROM rust:1.70.0-bullseye AS builder

WORKDIR /ord

# Copy the ord source code
COPY ord .

RUN cargo build --release

FROM node:20.11-bullseye-slim

WORKDIR /app

COPY . .

RUN cd modules/main_index && npm install \
    && cd ../brc20_api && npm install \
    && cd ../bitmap_api && npm install

# Bundle ord binary
COPY --from=builder /ord/target/release/ord /bin/ord

EXPOSE 3000

RUN npm install pm2 -g

CMD ["pm2-runtime", "ecosystem.config.js"]